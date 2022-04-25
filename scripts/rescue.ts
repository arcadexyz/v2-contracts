import { ethers } from "hardhat";

import { LoanTerms } from "../test/utils/types";
import { createLoanTermsSignature } from "../test/utils/eip712";

import { main as deploy } from "./deploy";
import { SECTION_SEPARATOR } from "./bootstrap-tools";
import { ERC721 } from "../typechain";

import SandboxAbi from "../sandbox_abi.json";

export async function main(): Promise<void> {
    // Bootstrap five accounts only.
    // Skip the first account, since the
    // first signer will be the deployer.
    const [, ...signers] = (await ethers.getSigners()).slice(0, 6);
    const [borrower, lender] = signers;

    console.log(SECTION_SEPARATOR);
    console.log("Deploying resources...\n");

    // Deploy the smart contracts
    // const {
    //     assetWrapper,
    //     originationController,
    //     repaymentController,
    //     loanCore,
    //     borrowerNote
    // } = await deploy();

    const assetWrapper = await (await ethers.getContractFactory("AssetWrapper")).attach("0xc3b2705A875305bc6B67ef000FC08183e48f7eb1");
    const originationController = await (await ethers.getContractFactory("OriginationController")).attach("0x199150b87Ca83F8672E092bAACb6fEcbA7E7dD0A");
    const repaymentController = await (await ethers.getContractFactory("RepaymentController")).attach("0xf6C8Ee885dAB34025cA275e269f8EC4BD85aD7FB");
    const loanCore = await (await ethers.getContractFactory("LoanCore")).attach("0xCB98358dcecbd4Aa884B4453A0734A9980654047");
    const borrowerNote = await (await ethers.getContractFactory("PromissoryNote")).attach("0x9B6fFFFd6B58eFcD442Db559eaE86c660958328D");

    console.log(SECTION_SEPARATOR);
    console.log("Creating bundle...\n");

    const MULTISIG_ADDRESS = "0x398e92C827C5FA0F33F171DC8E20570c5CfF330e";
    const BUNDLE_ID = 28;
    const BUNDLE_ID_2 = 29;
    const FLASH_ROLLOVER_ADDRESS = "0x541EBFD631cEee05c11FF2F348c53d1adbb5dBBE";
    const FIRST_LOAN_ID = 1;
    const SECOND_LOAN_ID = 2;

    const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const erc20Factory = await ethers.getContractFactory("ERC20");
    const weth = await erc20Factory.attach(WETH_ADDRESS);

    const SANDBOX_ADDRESS = "0x50f5474724e0ee42d9a4e711ccfb275809fd6d4a";
    const sandbox = new ethers.Contract(SANDBOX_ADDRESS, SandboxAbi, borrower);

    // Have borrowers create a bundle
    const awBorrower = await assetWrapper.connect(borrower);
    // let tx = await awBorrower.initializeBundleWithId(borrower.address, BUNDLE_ID);
    // await tx.wait();

    // let tx = await awBorrower.initializeBundleWithId(borrower.address, BUNDLE_ID_2);
    // await tx.wait();

    // Borrower signs loan terms
    const oneDayMs = 1000 * 60 * 60 * 24;
    const oneWeekMs = oneDayMs * 7;
    const relSecondsFromMs = (msToAdd: number) => Math.floor(msToAdd / 1000);

    const loanTerms: LoanTerms = {
        durationSecs: relSecondsFromMs(oneWeekMs),
        principal: ethers.utils.parseEther("0.0000001"),
        interest: ethers.utils.parseEther("0"),
        collateralTokenId: ethers.BigNumber.from(BUNDLE_ID),
        payableCurrency: WETH_ADDRESS,
    };

    console.log(SECTION_SEPARATOR);
    console.log("Starting loan...\n");

    const {
        v, r, s
    } = await createLoanTermsSignature(originationController.address, "OriginationController", loanTerms, borrower);

    // tx = await weth.connect(lender).approve(originationController.address, ethers.utils.parseEther("10"));
    // await tx.wait();
    // tx = await assetWrapper.connect(borrower).approve(originationController.address, BUNDLE_ID);
    // await tx.wait();

    // // Lender fills loan
    // tx = await originationController
    //     .connect(lender)
    //     .initializeLoan(loanTerms, borrower.address, lender.address, v, r, s);

    // await tx.wait();

    console.log(SECTION_SEPARATOR);
    console.log("Rolling over...\n");

    const rolloverTerms: LoanTerms = {
        durationSecs: relSecondsFromMs(oneWeekMs),
        principal: ethers.utils.parseEther("0.01"),
        interest: ethers.utils.parseEther("0"),
        collateralTokenId: ethers.BigNumber.from(BUNDLE_ID),
        payableCurrency: WETH_ADDRESS,
    };

    // Perform rollover
    const flashRolloverFactory = await ethers.getContractFactory("FlashRollover");
    const flashRollover = await flashRolloverFactory.attach(FLASH_ROLLOVER_ADDRESS);

    // tx = await borrowerNote.connect(borrower).approve(flashRollover.address, FIRST_LOAN_ID);
    // await tx.wait();

    // tx = await assetWrapper.connect(borrower).setApprovalForAll(originationController.address, true);
    // await tx.wait();

    // tx = await weth.connect(borrower).approve(flashRollover.address, rolloverTerms.principal);
    // await tx.wait();

    // tx = await weth.connect(borrower).approve(repaymentController.address, rolloverTerms.principal);
    // await tx.wait();

    // let tx = await weth.connect(lender).approve(flashRollover.address, rolloverTerms.principal.mul(10));
    // await tx.wait();


    const {
        v: rolloverV, r: rolloverR, s: rolloverS
    } = await createLoanTermsSignature(originationController.address, "OriginationController", rolloverTerms, borrower);

    const contracts = {
        sourceLoanCore: loanCore.address,
        targetLoanCore: loanCore.address,
        sourceRepaymentController: repaymentController.address,
        targetOriginationController: originationController.address,
    };

    // let tx = await flashRollover
    //     .connect(lender)
    //     .rolloverLoan(contracts, 1, rolloverTerms, rolloverV, rolloverR, rolloverS);

    // await tx.wait();

    console.log(SECTION_SEPARATOR);
    console.log("Repaying and withdrawing...\n");

    // Borrower repays
    // tx = await repaymentController.connect(borrower).repay(SECOND_LOAN_ID);
    // await tx.wait();


    // // Borrower withdraws asset wrapper
    // tx = await awBorrower.withdraw(BUNDLE_ID);
    // await tx.wait();

    console.log(SECTION_SEPARATOR);
    console.log("Sending to multisig...\n");

    // Borrower batch transfers all sandbox assets to multisig
    const IDS = [
        116530,
        117347,
        116939,
        116531,
        116123,
        115715,
        115307,
        112451,
        112043,
        111635,
        111227,
        110819,
        110411,
        117346,
        116938,
        116122,
        115714,
        115306,
        112450,
        112042
    ];

    // await sandbox.safeBatchTransferFrom(borrower.address, MULTISIG_ADDRESS, IDS, Buffer.from(""));

    const loanTerms2: LoanTerms = {
        durationSecs: relSecondsFromMs(oneWeekMs),
        principal: ethers.utils.parseEther("0.0000001"),
        interest: ethers.utils.parseEther("0"),
        collateralTokenId: ethers.BigNumber.from(BUNDLE_ID_2),
        payableCurrency: WETH_ADDRESS,
    };

    console.log(SECTION_SEPARATOR);
    console.log("Starting loan 2...\n");

    const {
        v: v2, r: r2, s: s2
    } = await createLoanTermsSignature(originationController.address, "OriginationController", loanTerms2, borrower);

    // tx = await weth.connect(lender).approve(originationController.address, ethers.utils.parseEther("10"));
    // await tx.wait();
    // tx = await assetWrapper.connect(borrower).approve(originationController.address, BUNDLE_ID_2);
    // await tx.wait();

    // // Lender fills loan
    // tx = await originationController
    //     .connect(lender)
    //     .initializeLoan(loanTerms2, borrower.address, lender.address, v2, r2, s2);
    // await tx.wait();

    console.log(SECTION_SEPARATOR);
    console.log("Rolling over...\n");

    const rolloverTerms2: LoanTerms = {
        durationSecs: relSecondsFromMs(oneWeekMs),
        principal: ethers.utils.parseEther("0.01"),
        interest: ethers.utils.parseEther("0"),
        collateralTokenId: ethers.BigNumber.from(BUNDLE_ID_2),
        payableCurrency: WETH_ADDRESS,
    };

    // Perform rollover
    // let tx = await borrowerNote.connect(borrower).approve(flashRollover.address, FIRST_LOAN_ID + 2);
    // await tx.wait();

    // tx = await assetWrapper.connect(borrower).setApprovalForAll(originationController.address, true);
    // await tx.wait();

    // tx = await weth.connect(borrower).approve(flashRollover.address, rolloverTerms2.principal);
    // await tx.wait();

    // tx = await weth.connect(borrower).approve(repaymentController.address, rolloverTerms2.principal);
    // await tx.wait();

    // tx = await weth.connect(lender).approve(flashRollover.address, rolloverTerms2.principal.mul(10));
    // await tx.wait();


    const {
        v: rolloverV2, r: rolloverR2, s: rolloverS2
    } = await createLoanTermsSignature(originationController.address, "OriginationController", rolloverTerms2, borrower);

    // tx = await flashRollover
    //     .connect(lender)
    //     .rolloverLoan(contracts, FIRST_LOAN_ID + 2, rolloverTerms2, rolloverV2, rolloverR2, rolloverS2);
    // await tx.wait();

    console.log(SECTION_SEPARATOR);
    console.log("Repaying and withdrawing...\n");

    // Borrower repays
    let tx = await repaymentController.connect(borrower).repay(SECOND_LOAN_ID + 2);
    await tx.wait();
    // Borrower withdraws asset wrapper
    tx = await awBorrower.withdraw(BUNDLE_ID_2);
    await tx.wait();
    console.log(SECTION_SEPARATOR);
    console.log("Sending to multisig...\n");

    // Borrower batch transfers all sandbox assets to multisig
    const IDS_2 = [
        111634,
        111226,
        110818,
        110410,
        117345,
        116937,
        116529,
        116121
    ];

    // await sandbox.safeBatchTransferFrom(borrower.address, MULTISIG_ADDRESS, IDS_2, Buffer.from(""));

    console.log("Final balance:")
    console.log((await sandbox.balanceOf(borrower.address)).toString());
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
