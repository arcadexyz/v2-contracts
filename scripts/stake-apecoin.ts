/* eslint no-unused-vars: 0 */

import hre, { ethers, upgrades } from "hardhat";
import { ApeCoinStaking, AssetVault, CallWhitelistApprovals, MockERC20, OriginationController, PromissoryNote, VaultFactory, RepaymentController } from "../typechain";

import { createVault } from "./utils/vault";
import { LoanTerms } from "../test/utils/types";
import { createLoanTermsSignature } from "../test/utils/eip712";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

/**
 * This script runs apecoin staking through end-to-end, by:
 *  - Setting up a user with a BAYC + 100k APE
 *  - Setting up a user with a MAYC + 100k APE
 *  - Setting up a user with a BAYC + BAKC + 100k APE
 *  - Setting up a user with a MAYC + BAKC + 100k APE
 *  - Setting up a time range for staking rewards for each pool
 *
 *  - Whitelisting the staking functions in the staking contract
 *  - Whitelisting the claim and withdraw functions in the staking contract
 *  - Starting loans for each user
 *  - Depositing apecoin for each user
 *
 *  - Advancing through the time range and claiming to escrow
 *  - Repaying the loans
 *  - Claiming directly to wallet after items withdrawn from vault.
 *
 */
export async function main(): Promise<void> {

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////                 GLOBALS                ////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const APE = "0x4d224452801ACEd8B2F0aebE155379bb5D594381";
    const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";
    const MAYC = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6";
    const BAKC = "0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623";
    const WHALE = "0x54BE3a794282C030b15E43aE2bB182E14c409C5e";
    const OWNER = "0xA2852f6E66cbA2A69685da5cB0A7e48dB8b3E05a";

    const ORIGINATION_CONTROLLER = "0x4c52ca29388A8A854095Fd2BeB83191D68DC840b";
    const REPAYMENT_CONTROLLER = "0xb39dAB85FA05C381767FF992cCDE4c94619993d4";
    const BORROWER_NOTE = "0x337104A4f06260Ff327d6734C555A0f5d8F863aa";
    const ARCADE_MSIG = "0x398e92C827C5FA0F33F171DC8E20570c5CfF330e";

    const [user1, user2, user3, user4, lender] = await ethers.getSigners();

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [WHALE],
    });

    const whale = await hre.ethers.getSigner(WHALE);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////      STEP 1: TOKEN DISTRIBUTION        ////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Distributing ApeCoin...");

    const factory20 = await ethers.getContractFactory("ERC20");
    const ape = await factory20.attach(APE);

    console.log("Distributing NFTs...");

    const factory721 = await ethers.getContractFactory("ERC721");
    const bayc = await factory721.attach(BAYC);
    const mayc = await factory721.attach(MAYC);
    const bakc = await factory721.attach(BAKC);

    const apeAmount = ethers.utils.parseEther("100");

    // Send APE to users
    await ape.connect(whale).transfer(user1.address, apeAmount);
    await ape.connect(whale).transfer(user2.address, apeAmount);
    await ape.connect(whale).transfer(user3.address, apeAmount);
    await ape.connect(whale).transfer(user4.address, apeAmount);
    await ape.connect(whale).transfer(OWNER, ethers.utils.parseEther("100000"));

    // Send NFTs to users
    await bayc.connect(whale).transferFrom(whale.address, user1.address, 3518);
    await bayc.connect(whale).transferFrom(whale.address, user3.address, 1044);
    await mayc.connect(whale).transferFrom(whale.address, user2.address, 11706);
    await mayc.connect(whale).transferFrom(whale.address, user4.address, 21026);
    await bakc.connect(whale).transferFrom(whale.address, user3.address, 6037);
    await bakc.connect(whale).transferFrom(whale.address, user4.address, 3292);

    // Send ETH to users for gas
    await whale.sendTransaction({ to: user1.address, value: ethers.utils.parseEther("0.5") });
    await whale.sendTransaction({ to: user2.address, value: ethers.utils.parseEther("0.5") });
    await whale.sendTransaction({ to: user3.address, value: ethers.utils.parseEther("0.5") });
    await whale.sendTransaction({ to: user4.address, value: ethers.utils.parseEther("0.5") });
    await whale.sendTransaction({ to: lender.address, value: ethers.utils.parseEther("0.5") });
    await whale.sendTransaction({ to: OWNER, value: ethers.utils.parseEther("0.5") });
    await whale.sendTransaction({ to: ARCADE_MSIG, value: ethers.utils.parseEther("0.5") });

    // Send mock tokens for loan principal
    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const token = <MockERC20>await tokenFactory.deploy("WETH", "WETH");

    await token.mint(user1.address, ethers.utils.parseEther("1000"));
    await token.mint(user2.address, ethers.utils.parseEther("1000"));
    await token.mint(user3.address, ethers.utils.parseEther("1000"));
    await token.mint(user4.address, ethers.utils.parseEther("1000"));
    await token.mint(lender.address, ethers.utils.parseEther("10000"));

    await token.connect(lender).approve(ORIGINATION_CONTROLLER, ethers.utils.parseEther("10000"));

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////          STEP 2: STAKING SETUP         ////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Initializing Pools...");

    // Set up rewards pool
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [OWNER],
    });

    const owner = await hre.ethers.getSigner(OWNER);

    const stakingFactory = await hre.ethers.getContractFactory("ApeCoinStaking");
    const staking = <ApeCoinStaking>await stakingFactory.connect(owner).deploy(APE, BAYC, MAYC, BAKC);

    await ape.connect(owner).transfer(staking.address, ethers.utils.parseEther("100000"));

    const latestBlock = (await hre.ethers.provider.getBlock("latest")).timestamp;
    const startTime = (latestBlock + 86400) - (latestBlock % 86400);

    await staking.connect(owner).addTimeRange(
        0,
        ethers.utils.parseEther("25000"),
        startTime,
        startTime + 3600,
        ethers.utils.parseEther("10000")
    );

    await staking.connect(owner).addTimeRange(
        1,
        ethers.utils.parseEther("25000"),
        startTime,
        startTime + 36000,
        ethers.utils.parseEther("10000")
    );

    await staking.connect(owner).addTimeRange(
        2,
        ethers.utils.parseEther("25000"),
        startTime,
        startTime + 36000,
        ethers.utils.parseEther("10000")
    );

    await staking.connect(owner).addTimeRange(
        3,
        ethers.utils.parseEther("25000"),
        startTime,
        startTime + 36000,
        ethers.utils.parseEther("10000")
    );

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /////////////////////// ///////          STEP 3: CALLWHITELIST DEPLOY         /////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Whitelisting vault functions...");

    // Set up rewards pool
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [ARCADE_MSIG],
    });

    const msig = await hre.ethers.getSigner(ARCADE_MSIG);

    // Set up lending protocol
    const whitelistFactory = await hre.ethers.getContractFactory("CallWhitelistApprovals");
    const whitelist = <CallWhitelistApprovals>await whitelistFactory.connect(msig).deploy();

    // Whitelist BAYC deposit - depositBAYC
    await whitelist.connect(msig).add(staking.address, "0x8f4972a9");
    // Whitelist MAYC deposit - depositMAYC
    await whitelist.connect(msig).add(staking.address, "0x4bd1e8f7");
    // Whitelist BAKC deposit - depositBAKC
    await whitelist.connect(msig).add(staking.address, "0x417a32f9");
    // Whitelist BAYC claim - claimSelfBAYC
    await whitelist.connect(msig).add(staking.address, "0x20a325d0");
    // Whitelist MAYC claim - claimSelfMAYC
    await whitelist.connect(msig).add(staking.address, "0x381b4682");
    // Whitelist BAKC claim - claimSelfBAKC
    await whitelist.connect(msig).add(staking.address, "0xb0847dec");
    // Whitelist BAYC withdraw - withdrawSelfBAYC
    await whitelist.connect(msig).add(staking.address, "0x3d0fa3b5");
    // Whitelist MAYC withdraw - withdrawSelfMAYC
    await whitelist.connect(msig).add(staking.address, "0xa1782c9d");
    // Whitelist BAKC withdraw  - withdrawBAKC
    await whitelist.connect(msig).add(staking.address, "0x8536c652");

    // Set up approvals
    await whitelist.connect(msig).setApproval(ape.address, staking.address, true);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////          STEP 4: VAULT DEPLOY          /////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const vaultTemplate = await hre.ethers.getContractFactory("AssetVault");
    const template = <AssetVault>await vaultTemplate.deploy();
    const vfFactory = await hre.ethers.getContractFactory("VaultFactory");
    const factory = <VaultFactory>await upgrades.deployProxy(
        vfFactory,
        [template.address, whitelist.address],
        { kind: "uups" },
    );

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////          STEP 5: LOAN ORIGINATION          //////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const ocFactory = await hre.ethers.getContractFactory("OriginationController");
    const originationController = <OriginationController>await ocFactory.attach(ORIGINATION_CONTROLLER);

    const makeTerms = (vault: AssetVault): LoanTerms => ({
        durationSecs: 86_400,
        principal: ethers.utils.parseEther("10"),
        interestRate: ethers.utils.parseEther("10"),
        collateralAddress: factory.address,
        collateralId: vault.address,
        payableCurrency: token.address,
        numInstallments: 0,
        deadline: Math.floor(Date.now() / 1000 + 1000)
    });

    const makeSig = async (signer: SignerWithAddress, terms: LoanTerms) =>
        createLoanTermsSignature(
            ORIGINATION_CONTROLLER,
            "OriginationController",
            terms,
            signer,
            "2",
            2,
            "b"
        );

    console.log("Starting loan 1...");

    // Set up loan against BAYC
    const av1 = await createVault(factory, user1);
    await bayc.connect(user1).transferFrom(user1.address, av1.address, 3518);
    await factory.connect(user1).approve(ORIGINATION_CONTROLLER, av1.address);

    const terms1 = makeTerms(av1);
    const sig1 = await makeSig(user1, terms1);

    await originationController
        .connect(lender)
        .initializeLoan(terms1, user1.address, lender.address, sig1, 2);

    console.log("Starting loan 2...");

    // Set up loan against MAYC
    const av2 = await createVault(factory, user2);
    await mayc.connect(user2).transferFrom(user2.address, av2.address, 11706);
    await factory.connect(user2).approve(ORIGINATION_CONTROLLER, av2.address);

    const terms2 = makeTerms(av2);
    const sig2 = await makeSig(user2, terms2);

    await originationController
        .connect(lender)
        .initializeLoan(terms2, user2.address, lender.address, sig2, 2);

    console.log("Starting loan 3...");

    // Set up loan against BAYC + BAKC
    const av3 = await createVault(factory, user3);
    await bayc.connect(user3).transferFrom(user3.address, av3.address, 1044);
    await bakc.connect(user3).transferFrom(user3.address, av3.address, 6037);
    await factory.connect(user3).approve(ORIGINATION_CONTROLLER, av3.address);

    const terms3 = makeTerms(av3);
    const sig3 = await makeSig(user3, terms3);

    await originationController
        .connect(lender)
        .initializeLoan(terms3, user3.address, lender.address, sig3, 2);

    console.log("Starting loan 4...");

    // set up loan against MAYC + BAKC
    const av4 = await createVault(factory, user4);
    await mayc.connect(user4).transferFrom(user4.address, av4.address, 21026);
    await bakc.connect(user4).transferFrom(user4.address, av4.address, 3292);
    await factory.connect(user4).approve(ORIGINATION_CONTROLLER, av4.address);

    const terms4 = makeTerms(av4);
    const sig4 = await makeSig(user4, terms4);

    await originationController
        .connect(lender)
        .initializeLoan(terms4, user4.address, lender.address, sig4, 2);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////          STEP 6: VAULT STAKING           //////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Performing Asset Vault approvals...");

    await ape.connect(user1).transfer(av1.address, apeAmount);
    await ape.connect(user2).transfer(av2.address, apeAmount);
    await ape.connect(user3).transfer(av3.address, apeAmount);
    await ape.connect(user4).transfer(av4.address, apeAmount);

    await av1.connect(user1).callApprove(ape.address, staking.address, apeAmount);
    await av2.connect(user2).callApprove(ape.address, staking.address, apeAmount);
    await av3.connect(user3).callApprove(ape.address, staking.address, apeAmount);
    await av4.connect(user4).callApprove(ape.address, staking.address, apeAmount);

    console.log("Performing staking operation...");

    let cd1 = staking.interface.encodeFunctionData("depositBAYC", [
        [{ tokenId: 3518, amount: apeAmount }]
    ]);

    let cd2 = staking.interface.encodeFunctionData("depositMAYC", [
        [{ tokenId: 11706, amount: apeAmount }]
    ]);

    let cd3 = staking.interface.encodeFunctionData("depositBAKC", [
        [{ mainTokenId: 1044, bakcTokenId: 6037, amount: apeAmount }],
        []
    ]);

    let cd4 = staking.interface.encodeFunctionData("depositBAKC", [
        [],
        [{ mainTokenId: 21026, bakcTokenId: 3292, amount: apeAmount }]
    ]);

    await av1.connect(user1).call(staking.address, cd1);
    await av2.connect(user2).call(staking.address, cd2);
    await av3.connect(user3).call(staking.address, cd3);
    await av4.connect(user4).call(staking.address, cd4);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////          STEP 7: STAKING CHECKPOINT           /////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Accruing staking rewards...");

    // Go through half of program
    await hre.network.provider.send("evm_setNextBlockTimestamp", [startTime]);
    await hre.network.provider.send("evm_mine", []);
    await hre.network.provider.send("evm_increaseTime", [18000]);
    await staking.updatePool(1);
    await staking.updatePool(2);
    await staking.updatePool(3);

    const pr1 = await staking.pendingRewards(1, av1.address, 3518);
    const pr2 = await staking.pendingRewards(2, av2.address, 11706);
    const pr3 = await staking.pendingRewards(3, av3.address, 6037);
    const pr4 = await staking.pendingRewards(3, av4.address, 3292);

    console.log("Pending Rewards User 1:", pr1.toString());
    console.log("Pending Rewards User 2:", pr2.toString());
    console.log("Pending Rewards User 3:", pr3.toString());
    console.log("Pending Rewards User 4:", pr4.toString());

    cd1 = staking.interface.encodeFunctionData("claimSelfBAYC", [[3518]]);
    cd2 = staking.interface.encodeFunctionData("claimSelfMAYC", [[11706]]);
    cd3 = staking.interface.encodeFunctionData("claimSelfBAKC", [
        [{ mainTokenId: 1044, bakcTokenId: 6037 }],
        [],
    ]);
    cd4 = staking.interface.encodeFunctionData("withdrawBAKC", [
        [],
        [{ mainTokenId: 21026, bakcTokenId: 3292, amount: apeAmount }]
    ]);

    // Have users 1, 2, 3 claim, have user 4 withdraw
    const balanceBefore1 = await ape.balanceOf(av1.address);
    await av1.connect(user1).call(staking.address, cd1);
    const balanceAfter1 = await ape.balanceOf(av1.address);
    const earned1 = balanceAfter1.sub(balanceBefore1);

    const balanceBefore2 = await ape.balanceOf(av2.address);
    await av2.connect(user2).call(staking.address, cd2);
    const balanceAfter2 = await ape.balanceOf(av2.address);
    const earned2 = balanceAfter2.sub(balanceBefore2);

    const balanceBefore3 = await ape.balanceOf(av3.address);
    await av3.connect(user3).call(staking.address, cd3);
    const balanceAfter3 = await ape.balanceOf(av3.address);
    const earned3 = balanceAfter3.sub(balanceBefore3);

    const balanceBefore4 = await ape.balanceOf(av4.address);
    await av4.connect(user4).call(staking.address, cd4);
    const balanceAfter4 = await ape.balanceOf(av4.address);
    const earned4 = balanceAfter4.sub(balanceBefore4);

    console.log("Claimed User 1:", earned1.toString());
    console.log("Claimed User 2:", earned2.toString());
    console.log("Claimed User 3:", earned3.toString());
    console.log("Claimed User 4:", earned4.toString());

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////              STEP 8: END STAKING              /////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////


    // Finish the program
    await hre.network.provider.send("evm_increaseTime", [18000]);

    // Repay all loans
    await token.connect(user1).approve(REPAYMENT_CONTROLLER, apeAmount.mul(2));
    await token.connect(user2).approve(REPAYMENT_CONTROLLER, apeAmount.mul(2));
    await token.connect(user3).approve(REPAYMENT_CONTROLLER, apeAmount.mul(2));
    await token.connect(user4).approve(REPAYMENT_CONTROLLER, apeAmount.mul(2));

    const rcFactory = await hre.ethers.getContractFactory("RepaymentController");
    const repaymentController = <RepaymentController>await rcFactory.attach(REPAYMENT_CONTROLLER);
    const pmFactory = await hre.ethers.getContractFactory("PromissoryNote");
    const note = <PromissoryNote>await pmFactory.attach(BORROWER_NOTE);

    const note1Id = await note.tokenOfOwnerByIndex(user1.address, 0);
    const note2Id = await note.tokenOfOwnerByIndex(user2.address, 0);
    const note3Id = await note.tokenOfOwnerByIndex(user3.address, 0);
    const note4Id = await note.tokenOfOwnerByIndex(user4.address, 0);

    await repaymentController.connect(user1).repay(note1Id);
    await repaymentController.connect(user2).repay(note2Id);
    await repaymentController.connect(user2).repay(note3Id);
    await repaymentController.connect(user2).repay(note4Id);

    console.log("Repaid all loans.");

    // Withdraw ape 1 from vault, claim rewards for user 1
    const b1_1 = await ape.balanceOf(user1.address);
    await av1.connect(user1).enableWithdraw();
    await av1.connect(user1).withdrawERC721(bayc.address, 3518, user1.address);
    await av1.connect(user1).withdrawERC20(ape.address, user1.address);

    const b1_2 = await ape.balanceOf(user1.address);
    await staking.connect(user1).withdrawBAYC([ { tokenId: 3518, amount: apeAmount }], user1.address);
    const b1_3 = await ape.balanceOf(user1.address);
    await staking.connect(user1).claimSelfBAYC([3518]);
    const b1_4 = await ape.balanceOf(user1.address);

    console.log("User 1 Balance before withdrawal:", ethers.utils.formatEther(b1_1));
    console.log("User 1 Balance after vault withdrawal:", ethers.utils.formatEther(b1_2));
    console.log("User 1 Balance after staking withdrawal:", ethers.utils.formatEther(b1_3));
    console.log("User 1 Balance after staking claim:", ethers.utils.formatEther(b1_4));

    // Withdraw MAYC into vault, then withdraw mutant and rewards for user 2
    const b2_1 = await ape.balanceOf(user2.address);

    cd2 = staking.interface.encodeFunctionData("withdrawSelfMAYC", [
        [{ tokenId: 11706, amount: apeAmount }]
    ]);

    await av2.connect(user2).call(staking.address, cd2);

    await av2.connect(user2).enableWithdraw();
    await av2.connect(user2).withdrawERC721(mayc.address, 11706, user2.address);
    await av2.connect(user2).withdrawERC20(ape.address, user2.address);

    const b2_2 = await ape.balanceOf(user2.address);
    const b2_3 = b2_2;
    await staking.connect(user2).claimSelfMAYC([11706]);
    const b2_4 = await ape.balanceOf(user2.address);

    console.log("User 2 Balance before withdrawal:", ethers.utils.formatEther(b2_1));
    console.log("User 2 Balance after vault withdrawal:", ethers.utils.formatEther(b2_2));
    console.log("User 2 Balance after staking withdrawal:", ethers.utils.formatEther(b2_3));
    console.log("User 2 Balance after staking claim:", ethers.utils.formatEther(b2_4));

    // Withdraw both from vault, claim rewards for user 3
    const b3_1 = await ape.balanceOf(user3.address);

    await av3.connect(user3).call(staking.address, cd3);

    await av3.connect(user3).enableWithdraw();
    await av3.connect(user3).withdrawERC721(bayc.address, 1044, user3.address);
    await av3.connect(user3).withdrawERC721(bakc.address, 6037, user3.address);
    await av3.connect(user3).withdrawERC20(ape.address, user3.address);

    const b3_2 = await ape.balanceOf(user3.address);
    const b3_3 = b3_2;
    await staking.connect(user3).withdrawBAKC(
        [{ mainTokenId: 1044, bakcTokenId: 6037, amount: apeAmount }],
        []
    );
    const b3_4 = await ape.balanceOf(user3.address);

    console.log("User 3 Balance before withdrawal:", ethers.utils.formatEther(b3_1));
    console.log("User 3 Balance after vault withdrawal:", ethers.utils.formatEther(b3_2));
    console.log("User 3 Balance after staking withdrawal:", ethers.utils.formatEther(b3_3));
    console.log("User 3 Balance after staking claim:", ethers.utils.formatEther(b3_4));

    // Withdraw from the vault for user 4 and claim latent rewards
    const b4_1 = await ape.balanceOf(user4.address);

    await av4.connect(user4).enableWithdraw();
    await av4.connect(user4).withdrawERC721(mayc.address, 21026, user4.address);
    await av4.connect(user4).withdrawERC721(bakc.address, 3292, user4.address);
    await av4.connect(user4).withdrawERC20(ape.address, user4.address);

    const b4_2 = await ape.balanceOf(user4.address);
    const b4_3 = b4_2;
    const b4_4 = b4_2;

    console.log("User 4 Balance before withdrawal:", ethers.utils.formatEther(b4_1));
    console.log("User 4 Balance after vault withdrawal:", ethers.utils.formatEther(b4_2));
    console.log("User 4 Balance after staking withdrawal:", ethers.utils.formatEther(b4_3));
    console.log("User 4 Balance after staking claim:", ethers.utils.formatEther(b4_4));
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
