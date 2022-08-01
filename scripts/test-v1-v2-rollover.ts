/* eslint no-unused-vars: 0 */
import "@nomiclabs/hardhat-ethers";
import hre, { ethers } from "hardhat";

import { SECTION_SEPARATOR } from "./utils/bootstrap-tools";
import { ERC20, PromissoryNote, FlashRolloverV1toV2, VaultFactory } from "../typechain";

import { createLoanTermsSignature } from "../test/utils/eip712";
import { LoanTerms } from "../test/utils/types";

export async function main(): Promise<void> {
    // Also distribute USDC by impersonating a large account
    const BORROWER = "0x5cdde918f2d0d20e001a31cacc38cc16230a19c0";
    const LENDER = "0xb22eb63e215ba39f53845c7ac172a7139f20ea13";
    const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const WHALE = "0xf584f8728b874a6a5c7a8d4d387c9aae9172d621";
    const OC_ADDRESS = "0x4c52ca29388A8A854095Fd2BeB83191D68DC840b";
    const VAULT_FACTORY_ADDRESS = "0x6e9B4c2f6Bd57b7b924d29b5dcfCa1273Ecc94A2";
    const ADDRESSES_PROVIDER_ADDRESS = "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5";
    const BORROWER_NOTE_ADDRESS = "0xc3231258D6Ed397Dce7a52a27f816c8f41d22151";

    const [newLender] = await hre.ethers.getSigners();

    const LOAN_ID = 29;
    const NONCE = 2;
    const repayAmount = ethers.utils.parseUnits("129687.5", 6);

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [WHALE],
    });

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [BORROWER],
    });

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [LENDER],
    });

    const borrower = await hre.ethers.getSigner(BORROWER);
    const lender = await hre.ethers.getSigner(LENDER);
    const whale = await hre.ethers.getSigner(WHALE);

    const erc20Factory = await ethers.getContractFactory("ERC20");
    const usdc = <ERC20>await erc20Factory.attach(USDC_ADDRESS);

    const erc721Factory = await ethers.getContractFactory("ERC721");
    const note = <PromissoryNote>await erc721Factory.attach(BORROWER_NOTE_ADDRESS);

    console.log("Deploying rollover...");

    const factory = await ethers.getContractFactory("FlashRolloverV1toV2")
    const flashRollover = <FlashRolloverV1toV2>await factory.deploy(ADDRESSES_PROVIDER_ADDRESS);

    console.log("Doing approvals...");

    await whale.sendTransaction({ to: borrower.address, value: ethers.utils.parseEther("100") });
    await whale.sendTransaction({ to: lender.address, value: ethers.utils.parseEther("100") });
    await whale.sendTransaction({ to: newLender.address, value: ethers.utils.parseEther("100") });
    await usdc.connect(whale).transfer(newLender.address, ethers.utils.parseUnits("1000000", 6))
    await usdc.connect(whale).transfer(borrower.address, ethers.utils.parseUnits("100000", 6))

    // Lender approves USDC
    await usdc.connect(newLender).approve(OC_ADDRESS, ethers.utils.parseUnits("100000000000", 6));

    // Borrower approves USDC and borrower note
    await usdc.connect(borrower).approve(flashRollover.address, ethers.utils.parseUnits("100000000000", 6));
    await note.connect(borrower).approve(flashRollover.address, LOAN_ID);

    console.log("Creating a vault...");

    // Lender creates vault
    const vfFactory = await ethers.getContractFactory("VaultFactory");
    const vaultFactory = <VaultFactory>await vfFactory.attach(VAULT_FACTORY_ADDRESS);

    const initTx = await vaultFactory.connect(borrower).initializeBundle(borrower.address);
    const initReceipt = await initTx.wait();

    const createdEvent = initReceipt.events?.find(e => e.event === "VaultCreated");
    const vault = createdEvent?.args?.[0];

    console.log(`Approving vault ${vault}...`);

    // Lender approves vault
    await vaultFactory.connect(borrower).approve(flashRollover.address, vault);

    console.log("Creating signature...");

    const loanTerms: LoanTerms = {
        durationSecs: 7776000,
        deadline: Math.floor(Date.now() / 1000) + 100_000,
        numInstallments: 0,
        interestRate: ethers.utils.parseEther("3.75"),
        principal: repayAmount,
        collateralAddress: VAULT_FACTORY_ADDRESS,
        collateralId: vault,
        payableCurrency: USDC_ADDRESS
    };

    // Lender signs message to terms
    const sig = await createLoanTermsSignature(
        OC_ADDRESS,
        "OriginationController",
        loanTerms,
        newLender,
        "2",
        NONCE,
        "l",
    );

    console.log("Doing rollover...");

    const contracts = {
        sourceLoanCore: "0x7691EE8feBD406968D46F9De96cB8CC18fC8b325",
        targetLoanCore: "0x81b2F8Fc75Bab64A6b144aa6d2fAa127B4Fa7fD9",
        sourceRepaymentController: "0xD7B4586b4eD87e2B98aD2df37A6c949C5aB1B1dB",
        targetOriginationController: "0x4c52ca29388A8A854095Fd2BeB83191D68DC840b",
        targetVaultFactory: "0x6e9B4c2f6Bd57b7b924d29b5dcfCa1273Ecc94A2"
    };

    await flashRollover.connect(borrower).rolloverLoan(
        contracts,
        LOAN_ID,
        loanTerms,
        newLender.address,
        NONCE,
        sig.v,
        sig.r,
        sig.s
    );

    // // Roll over both loans
    console.log(SECTION_SEPARATOR);
    console.log("Rollover successful.\n");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}