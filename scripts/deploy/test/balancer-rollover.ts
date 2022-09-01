import { expect } from "chai";
import { ethers, artifacts } from "hardhat";
import assert from "assert";

import {
    NETWORK,
    IS_MAINNET_FORK,
    v1AssetWrapperAbi,
    v1OriginationControllerAbi,
    createLoanTermsSignature
} from "./utils";

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
const ORIGINATION_CONTROLLER = "0xf72516d0d038Ec8c0Ef0Fe8f7f4EEaD8Ee1c31E2";

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

    // V1 contracts
    let assetWrapper: Contract;
    let originationController: Contract;

    before(async () => {
        [, borrower, lender] = await ethers.getSigners();

        // Deploy tokens and NFTs and mint to counterparties
        const tokenFactory = await ethers.getContractFactory("MockERC20");
        mockToken = <MockERC20>await tokenFactory.deploy("Arcade Token", "ARC");
        await mockToken.mint(lender.address, ethers.utils.parseEther("100000"));

        expect(await mockToken.balanceOf(lender.address)).to.eq(ethers.utils.parseEther("100000"));

        const nftFactory = await ethers.getContractFactory("MockERC721");
        mockNft = <MockERC721>await nftFactory.deploy("Arcade NFT", "ARCNFT");
        await mockNft.mint(borrower.address);

        expect(await mockNft.balanceOf(borrower.address)).to.eq(1);
        nftId = await mockNft.tokenOfOwnerByIndex(borrower.address, 0);

        // Attach V1 contracts
        assetWrapper = new ethers.Contract(ASSET_WRAPPER, v1AssetWrapperAbi, borrower);
        originationController = new ethers.Contract(ORIGINATION_CONTROLLER, v1OriginationControllerAbi, borrower);
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
        console.log("Gonna deposit");
        await assetWrapper.connect(borrower).depositERC721(mockNft.adddress, nftId, bundleId);
        console.log("Deposited");
        await assetWrapper.connect(borrower).approve(originationController.address, bundleId);
        console.log("Deposited 2");

        // Lender does approvals and creates signature
        const terms = {
            durationSecs: 604800,
            principal: ethers.utils.parseEther("100"),
            interest: ethers.utils.parseEther("15"),
            collateralTokenId: bundleId,
            payableCurrency: mockToken.address,
        };

        const { v, r, s } = await createLoanTermsSignature(originationController.address, "OriginationController", terms, lender);

        await mockToken.connect(lender).approve(originationController.address, ethers.utils.parseEther("1000"));

        await originationController.connect(borrower).initializeLoan(terms, borrower, lender, v, r, s);
    });

    it("rolls the loan over from V1 to V2, using balancer", async () => {

    })
});