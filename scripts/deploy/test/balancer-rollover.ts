import chai, { expect } from "chai";
import { ethers, artifacts } from "hardhat";
import { solidity } from "ethereum-waffle";
import assert from "assert";

chai.use(solidity);

import {
    NETWORK,
    IS_MAINNET_FORK,
    v1AssetWrapperAbi,
    v1OriginationControllerAbi,
    createLoanTermsSignature as makeV1Signature
} from "./utils";

import { LoanTerms } from "../../../test/utils/types";
import { createLoanTermsSignature } from "../../../test/utils/eip712";

import {
    BalancerFlashRolloverV1toV2, MockERC20, MockERC721
} from "../../../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumberish, Contract } from "ethers";

/**
 * Note: this test requires full mainnet fork context, so we can pull in the V1 protocol
 * without having to redeploy everything.
 */
assert(NETWORK === "hardhat" && IS_MAINNET_FORK, "Must use a mainnet fork!");

const VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
const ASSET_WRAPPER = "0x5CB803c31e8f4F895a3AB19d8218646dC63e9Dc2";
const SOURCE_ORIGINATION_CONTROLLER = "0xf72516d0d038Ec8c0Ef0Fe8f7f4EEaD8Ee1c31E2";
const SOURCE_LOAN_CORE_ADDRESS = "0x7691EE8feBD406968D46F9De96cB8CC18fC8b325";
const TARGET_LOAN_CORE_ADDRESS = "0x81b2F8Fc75Bab64A6b144aa6d2fAa127B4Fa7fD9";
const SOURCE_REPAYMENT_CONTROLLER = "0xD7B4586b4eD87e2B98aD2df37A6c949C5aB1B1dB";
const TARGET_ORIGINATION_CONTROLLER = "0x4c52ca29388A8A854095Fd2BeB83191D68DC840b";
const VAULT_FACTORY = "0x6e9B4c2f6Bd57b7b924d29b5dcfCa1273Ecc94A2";
const BORROWER_NOTE = "0xc3231258D6Ed397Dce7a52a27f816c8f41d22151";

const createLoanTerms = (
    payableCurrency: string,
    collateralAddress: string,
    {
        durationSecs = ethers.BigNumber.from(360000),
        principal = ethers.utils.parseEther("100"),
        interestRate = ethers.utils.parseEther("1"),
        collateralId = "1",
        numInstallments = 0,
        deadline = 1754884800,
    }: Partial<LoanTerms> = {},
): LoanTerms => {
    return {
        durationSecs,
        principal,
        interestRate,
        collateralId,
        collateralAddress,
        payableCurrency,
        numInstallments,
        deadline,
    };
};

describe("Deployment", function () {
    this.timeout(0);
    this.bail();

    // Test contracts
    let rollover: BalancerFlashRolloverV1toV2;
    let mockToken: MockERC20;
    let mockNft: MockERC721;
    let borrower: SignerWithAddress;
    let lender: SignerWithAddress;
    let nftId: BigNumberish;
    let loanId: BigNumberish;

    // Protocl contracts
    let assetWrapper: Contract;
    let originationController: Contract;
    let vaultFactory: Contract;
    let borrowerNote: Contract;

    before(async () => {
        [, borrower, lender] = await ethers.getSigners();

        // Deploy tokens and NFTs and mint to counterparties
        const tokenFactory = await ethers.getContractFactory("MockERC20");
        mockToken = <MockERC20>await tokenFactory.deploy("Arcade Token", "ARC");

        // Send tokens to lender and balancer vault (for flash loans)
        await mockToken.mint(lender.address, ethers.utils.parseEther("100000"));
        await mockToken.mint(VAULT_ADDRESS, ethers.utils.parseEther("100000000"));

        expect(await mockToken.balanceOf(lender.address)).to.eq(ethers.utils.parseEther("100000"));

        const nftFactory = await ethers.getContractFactory("MockERC721");
        mockNft = <MockERC721>await nftFactory.deploy("Arcade NFT", "ARCNFT");
        await mockNft.mint(borrower.address);

        expect(await mockNft.balanceOf(borrower.address)).to.eq(1);
        nftId = await mockNft.tokenOfOwnerByIndex(borrower.address, 0);

        // Attach V1 contracts
        assetWrapper = new ethers.Contract(ASSET_WRAPPER, v1AssetWrapperAbi, borrower);
        originationController = new ethers.Contract(SOURCE_ORIGINATION_CONTROLLER, v1OriginationControllerAbi, borrower);

        const vaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
        vaultFactory = await vaultFactoryFactory.attach(VAULT_FACTORY);

        const noteFactory = await ethers.getContractFactory("ERC721");
        borrowerNote = await noteFactory.attach(BORROWER_NOTE);
    });


    it("deploys rollover contract", async () => {
        const factory = await ethers.getContractFactory("BalancerFlashRolloverV1toV2")
        rollover = <BalancerFlashRolloverV1toV2>await factory.deploy(VAULT_ADDRESS);

        await rollover.deployed();

        expect(rollover.address).to.not.be.undefined;
    });

    it("starts a loan on the V1 protocol", async () => {
        // Borrower creates bundle and approves it
        await assetWrapper.initializeBundle(borrower.address);
        const bundleId = await assetWrapper.tokenOfOwnerByIndex(borrower.address, 0);

        await mockNft.connect(borrower).approve(assetWrapper.address, nftId);
        await assetWrapper.connect(borrower).depositERC721(mockNft.address, nftId, bundleId);
        await assetWrapper.connect(borrower).approve(originationController.address, bundleId);

        // Lender does approvals and creates signature
        const terms = {
            durationSecs: 604800,
            principal: ethers.utils.parseEther("100"),
            interest: ethers.utils.parseEther("15"),
            collateralTokenId: bundleId,
            payableCurrency: mockToken.address,
        };

        const { v, r, s } = await makeV1Signature(originationController.address, "OriginationController", terms, lender);

        await mockToken.connect(lender).approve(originationController.address, ethers.utils.parseEther("1000"));

        const tx = await originationController.connect(borrower).initializeLoan(terms, borrower.address, lender.address, v, r, s)
        const receipt = await tx.wait();

        const loanCoreEvents = receipt.logs.filter((e: any) => e.address === SOURCE_LOAN_CORE_ADDRESS);
        expect(loanCoreEvents.length).to.eq(2);
        const loanStartedEvent = loanCoreEvents[1];
        expect(loanStartedEvent).to.not.be.undefined;

        const loanCore = new ethers.utils.Interface([
            "event LoanStarted(uint256 loanId, address lender, address borrower)"
        ]);

        const payload = loanCore.parseLog(loanStartedEvent);

        expect(payload.args.loanId).to.not.be.undefined;
        loanId = payload.args.loanId;
    });

    it("rolls the loan over from V1 to V2, using balancer", async () => {
        // Create vault for borrower
        const tx = await vaultFactory.connect(borrower).initializeBundle(borrower.address);
        const receipt = await tx.wait();

        const vcEvent = receipt.events.find((e: any) => e.event === "VaultCreated");
        expect(vcEvent).to.not.be.undefined;

        const vaultId = vcEvent.args.vault;

        // Have lender sign approval for rollover
        const terms = createLoanTerms(
            mockToken.address,
            VAULT_FACTORY,
            {
                durationSecs: 604800,
                principal: ethers.utils.parseEther("150"),
                interestRate: ethers.utils.parseEther("10"),
                collateralId: vaultId
            }
        );

        const sig = await createLoanTermsSignature(
            TARGET_ORIGINATION_CONTROLLER,
            "OriginationController",
            terms,
            borrower,
            "2",
            1,
            "b",
        );

        // Do approvals
        await mockToken.connect(lender).approve(TARGET_ORIGINATION_CONTROLLER, ethers.utils.parseEther("1000"));

        await mockToken.connect(borrower).approve(rollover.address, ethers.utils.parseEther("1000"));
        await borrowerNote.connect(borrower).approve(rollover.address, loanId);
        await vaultFactory.connect(borrower).approve(rollover.address, vaultId);

        // Set up params
        const contracts = {
            sourceLoanCore: SOURCE_LOAN_CORE_ADDRESS,
            targetLoanCore: TARGET_LOAN_CORE_ADDRESS,
            sourceRepaymentController: SOURCE_REPAYMENT_CONTROLLER,
            targetOriginationController: TARGET_ORIGINATION_CONTROLLER,
            targetVaultFactory: VAULT_FACTORY
        };

        // Call rollover and check event payload
        await rollover.connect(borrower).rolloverLoan(
            contracts,
            loanId,
            terms,
            lender.address,
            1, // nonce
            sig.v,
            sig.r,
            sig.s
        );

        // Check all balances are correct
    });
});