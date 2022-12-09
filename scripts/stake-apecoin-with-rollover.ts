/* eslint no-unused-vars: 0 */

import hre, { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { ApeCoinStaking, AssetVault, CallWhitelistApprovals, MockERC20, OriginationController, PromissoryNote, VaultFactory, RepaymentController, FlashRolloverStakingVaultUpgrade } from "../typechain";

import { createVault } from "./utils/vault";
import { ItemsPredicate, LoanTerms, SignatureItem } from "../test/utils/types";
import { createLoanItemsSignature } from "../test/utils/eip712";
import { encodePredicates, encodeSignatureItems } from "../test/utils/loans";
import { main as deployRollover } from "./deploy/deploy-vault-upgrade-rollover";
import { encode } from "querystring";

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
    const BAYC_WHALE = "0x54BE3a794282C030b15E43aE2bB182E14c409C5e";
    const ETH_WHALE = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const OWNER = "0xA2852f6E66cbA2A69685da5cB0A7e48dB8b3E05a";
    const VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

    const LOAN_CORE = "0x81b2F8Fc75Bab64A6b144aa6d2fAa127B4Fa7fD9";
    const ORIGINATION_CONTROLLER = "0x4c52ca29388A8A854095Fd2BeB83191D68DC840b";
    const REPAYMENT_CONTROLLER = "0xb39dAB85FA05C381767FF992cCDE4c94619993d4";
    const BORROWER_NOTE = "0x337104A4f06260Ff327d6734C555A0f5d8F863aa";
    const ARCADE_MSIG = "0x398e92C827C5FA0F33F171DC8E20570c5CfF330e";
    const OLD_FACTORY = "0x6e9B4c2f6Bd57b7b924d29b5dcfCa1273Ecc94A2";
    const VERIFIER = "0xAbfD9D9E4157695DB5812eeE279D923a4f948Df0";

    const [user1, user2, user3, user4, lender] = await ethers.getSigners();

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [BAYC_WHALE],
    });

    const baycWhale = await hre.ethers.getSigner(BAYC_WHALE);

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [ETH_WHALE],
    });

    const ethWhale = await hre.ethers.getSigner(ETH_WHALE);

    await ethWhale.sendTransaction({ to: BAYC_WHALE, value: ethers.utils.parseEther("10") });

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
    await ape.connect(baycWhale).transfer(user1.address, apeAmount);
    await ape.connect(baycWhale).transfer(user2.address, apeAmount);
    await ape.connect(baycWhale).transfer(user3.address, apeAmount);
    await ape.connect(baycWhale).transfer(user4.address, apeAmount);
    await ape.connect(baycWhale).transfer(OWNER, ethers.utils.parseEther("100000"));

    // Send NFTs to users
    await bayc.connect(baycWhale).transferFrom(baycWhale.address, user1.address, 3518);
    await bayc.connect(baycWhale).transferFrom(baycWhale.address, user3.address, 1044);
    await mayc.connect(baycWhale).transferFrom(baycWhale.address, user2.address, 11706);
    await mayc.connect(baycWhale).transferFrom(baycWhale.address, user4.address, 21026);
    await bakc.connect(baycWhale).transferFrom(baycWhale.address, user3.address, 6037);
    await bakc.connect(baycWhale).transferFrom(baycWhale.address, user4.address, 3292);

    // Send ETH to users for gas
    await ethWhale.sendTransaction({ to: user1.address, value: ethers.utils.parseEther("0.5") });
    await ethWhale.sendTransaction({ to: user2.address, value: ethers.utils.parseEther("0.5") });
    await ethWhale.sendTransaction({ to: user3.address, value: ethers.utils.parseEther("0.5") });
    await ethWhale.sendTransaction({ to: user4.address, value: ethers.utils.parseEther("0.5") });
    await ethWhale.sendTransaction({ to: lender.address, value: ethers.utils.parseEther("0.5") });
    await ethWhale.sendTransaction({ to: OWNER, value: ethers.utils.parseEther("0.5") });
    await ethWhale.sendTransaction({ to: ARCADE_MSIG, value: ethers.utils.parseEther("0.5") });

    // Send mock tokens for loan principal
    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const token = <MockERC20>await tokenFactory.deploy("WETH", "WETH");

    await token.mint(user1.address, ethers.utils.parseEther("1000"));
    await token.mint(user2.address, ethers.utils.parseEther("1000"));
    await token.mint(user3.address, ethers.utils.parseEther("1000"));
    await token.mint(user4.address, ethers.utils.parseEther("1000"));
    await token.mint(lender.address, ethers.utils.parseEther("10000"));
    await token.mint(VAULT, ethers.utils.parseEther("1000000"));

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
    const oldFactory = <VaultFactory>await vfFactory.attach(OLD_FACTORY);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /////////////////////////////////          STEP 5: ROLLOVER DEPLOY          ///////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const { flashRollover: rollover } = await deployRollover(
        LOAN_CORE,
        REPAYMENT_CONTROLLER,
        ORIGINATION_CONTROLLER,
        OLD_FACTORY,
        factory.address,
    );

    const noteFactory = await hre.ethers.getContractFactory("PromissoryNote");
    const note = <PromissoryNote>await noteFactory.attach(BORROWER_NOTE);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////          STEP 6: LOAN ORIGINATION          //////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const ocFactory = await hre.ethers.getContractFactory("OriginationController");
    const originationController = <OriginationController>await ocFactory.attach(ORIGINATION_CONTROLLER);

    const makeTerms = (vault: AssetVault, factory = oldFactory): LoanTerms => ({
        durationSecs: 86_400,
        principal: ethers.utils.parseEther("10"),
        interestRate: ethers.utils.parseEther("10"),
        collateralAddress: factory.address,
        collateralId: vault.address,
        payableCurrency: token.address,
        numInstallments: 0,
        deadline: Math.floor(Date.now() / 1000 + 1000)
    });

    const makeSig = async (signer: SignerWithAddress, terms: LoanTerms, predicates: ItemsPredicate[], nonce = 2) =>
        createLoanItemsSignature(
            ORIGINATION_CONTROLLER,
            "OriginationController",
            terms,
            encodePredicates(predicates),
            signer,
            "2",
            nonce,
            "b"
        );

    console.log("Starting loan 1...");

    // Set up loan against BAYC
    let av1 = await createVault(oldFactory, user1);
    await bayc.connect(user1).transferFrom(user1.address, av1.address, 3518);
    await oldFactory.connect(user1).approve(ORIGINATION_CONTROLLER, av1.address);

    let terms1 = makeTerms(av1);
    const items1: SignatureItem[] = [
        {
            cType: 0,
            asset: bayc.address,
            tokenId: 3518,
            amount: 0
        }
    ];
    const predicates1: ItemsPredicate[] = [
        {
            verifier: VERIFIER,
            data: encodeSignatureItems(items1)
        }
    ];
    let sig1 = await makeSig(user1, terms1, predicates1);

    await originationController
        .connect(lender)
        .initializeLoanWithItems(terms1, user1.address, lender.address, sig1, 2, predicates1);

    console.log("Starting loan 2...");

    // Set up loan against MAYC
    let av2 = await createVault(oldFactory, user2);
    await mayc.connect(user2).transferFrom(user2.address, av2.address, 11706);
    await oldFactory.connect(user2).approve(ORIGINATION_CONTROLLER, av2.address);

    let terms2 = makeTerms(av2);
    const items2: SignatureItem[] = [
        {
            cType: 0,
            asset: mayc.address,
            tokenId: 11706,
            amount: 0
        }
    ];
    const predicates2: ItemsPredicate[] = [
        {
            verifier: VERIFIER,
            data: encodeSignatureItems(items2)
        }
    ];
    let sig2 = await makeSig(user2, terms2, predicates2);

    await originationController
        .connect(lender)
        .initializeLoanWithItems(terms2, user2.address, lender.address, sig2, 2, predicates2);

    console.log("Starting loan 3...");

    // Set up loan against BAYC + BAKC
    let av3 = await createVault(oldFactory, user3);
    await bayc.connect(user3).transferFrom(user3.address, av3.address, 1044);
    await bakc.connect(user3).transferFrom(user3.address, av3.address, 6037);
    await oldFactory.connect(user3).approve(ORIGINATION_CONTROLLER, av3.address);

    let terms3 = makeTerms(av3);
    const items3: SignatureItem[] = [
        {
            cType: 0,
            asset: bayc.address,
            tokenId: 1044,
            amount: 0
        },
        {
            cType: 0,
            asset: bakc.address,
            tokenId: 6037,
            amount: 0
        }
    ];
    const predicates3: ItemsPredicate[] = [
        {
            verifier: VERIFIER,
            data: encodeSignatureItems(items3)
        }
    ];
    let sig3 = await makeSig(user3, terms3, predicates3);

    await originationController
        .connect(lender)
        .initializeLoanWithItems(terms3, user3.address, lender.address, sig3, 2, predicates3);

    console.log("Starting loan 4...");

    // set up loan against MAYC + BAKC
    let av4 = await createVault(oldFactory, user4);
    await mayc.connect(user4).transferFrom(user4.address, av4.address, 21026);
    await bakc.connect(user4).transferFrom(user4.address, av4.address, 3292);
    await oldFactory.connect(user4).approve(ORIGINATION_CONTROLLER, av4.address);

    let terms4 = makeTerms(av4);
    const items4: SignatureItem[] = [
        {
            cType: 0,
            asset: mayc.address,
            tokenId: 21026,
            amount: 0
        },
        // DO NOT include, since this item will be forgotten
        // in the rollover vaultItems
        // {
        //     cType: 0,
        //     asset: bakc.address,
        //     tokenId: 3292,
        //     amount: 0
        // }
    ];
    const predicates4: ItemsPredicate[] = [
        {
            verifier: VERIFIER,
            data: encodeSignatureItems(items4)
        }
    ];
    let sig4 = await makeSig(user4, terms4, predicates4);

    await originationController
        .connect(lender)
        .initializeLoanWithItems(terms4, user4.address, lender.address, sig4, 2, predicates4);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////            STEP 7: ROLLOVERS             //////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const makeRolloverSig = async (signer: SignerWithAddress, terms: LoanTerms, predicates: ItemsPredicate[], nonce = 3) =>
        createLoanItemsSignature(
            ORIGINATION_CONTROLLER,
            "OriginationController",
            terms,
            encodePredicates(predicates),
            signer,
            "2",
            nonce,
            "l"
        );

    // Roll over each loan to a new vault
    console.log("Rolling over loan 1...");

    av1 = await createVault(factory, user1);
    terms1 = makeTerms(av1, factory);
    sig1 = await makeRolloverSig(lender, terms1, predicates1, 3);
    let note1Id = await note.tokenOfOwnerByIndex(user1.address, 0);
    await note.connect(user1).approve(rollover.address, note1Id);
    await token.connect(user1).approve(rollover.address, ethers.utils.parseEther("10000"));
    await factory.connect(user1).approve(rollover.address, av1.address);

    await rollover.connect(user1).rolloverLoan({
        loanId: note1Id,
        newLoanTerms: terms1,
        itemPredicates: predicates1,
        lender: lender.address,
        nonce: 3,
        vaultItems: [
            {
                cType: 0,
                asset: bayc.address,
                tokenId: 3518,
                amount: 0
            }
        ],
        v: sig1.v,
        r: sig1.r,
        s: sig1.s
    });

    console.log("Rolling over loan 2...");

    av2 = await createVault(factory, user2);
    terms2 = makeTerms(av2, factory);
    sig2 = await makeRolloverSig(lender, terms2, predicates2, 4);
    let note2Id = await note.tokenOfOwnerByIndex(user2.address, 0);
    await note.connect(user2).approve(rollover.address, note2Id);
    await token.connect(user2).approve(rollover.address, ethers.utils.parseEther("10000"));
    await factory.connect(user2).approve(rollover.address, av2.address);

    await rollover.connect(user2).rolloverLoan({
        loanId: note2Id,
        newLoanTerms: terms2,
        itemPredicates: predicates2,
        lender: lender.address,
        nonce: 4,
        vaultItems: [
            {
                cType: 0,
                asset: mayc.address,
                tokenId: 11706,
                amount: 0
            }
        ],
        v: sig2.v,
        r: sig2.r,
        s: sig2.s
    });

    console.log("Rolling over loan 3...");

    av3 = await createVault(factory, user3);
    terms3 = makeTerms(av3, factory);
    sig3 = await makeRolloverSig(lender, terms3, predicates3, 5);
    let note3Id = await note.tokenOfOwnerByIndex(user3.address, 0);
    await note.connect(user3).approve(rollover.address, note3Id);
    await token.connect(user3).approve(rollover.address, ethers.utils.parseEther("10000"));
    await factory.connect(user3).approve(rollover.address, av3.address);

    await rollover.connect(user3).rolloverLoan({
        loanId: note3Id,
        newLoanTerms: terms3,
        itemPredicates: predicates3,
        lender: lender.address,
        nonce: 5,
        vaultItems: [
            {
                cType: 0,
                asset: bayc.address,
                tokenId: 1044,
                amount: 0
            },
            {
                cType: 0,
                asset: bakc.address,
                tokenId: 6037,
                amount: 0
            }
        ],
        v: sig3.v,
        r: sig3.r,
        s: sig3.s
    });

    console.log("Rolling over loan 4...");

    const av4Old = av4;
    av4 = await createVault(factory, user4);
    terms4 = makeTerms(av4, factory);
    sig4 = await makeRolloverSig(lender, terms4, predicates4, 6);
    let note4Id = await note.tokenOfOwnerByIndex(user4.address, 0);
    await note.connect(user4).approve(rollover.address, note4Id);
    await token.connect(user4).approve(rollover.address, ethers.utils.parseEther("10000"));
    await factory.connect(user4).approve(rollover.address, av4.address);

    // FORGET one vault item.
    // Then rescue it, and send it to the new vault.
    await rollover.connect(user4).rolloverLoan({
        loanId: note4Id,
        newLoanTerms: terms4,
        itemPredicates: predicates4,
        lender: lender.address,
        nonce: 6,
        vaultItems: [
            {
                cType: 0,
                asset: mayc.address,
                tokenId: 21026,
                amount: 0
            },
            // {
            //     cType: 0,
            //     asset: bakc.address,
            //     tokenId: 3292,
            //     amount: 0
            // }
        ],
        v: sig4.v,
        r: sig4.r,
        s: sig4.s
    });

    console.log("Rescuing a loan 4 item after rollover...");

    await rollover.rescueVaultItem(
        av4Old.address,
        {
            cType: 0,
            asset: bakc.address,
            tokenId: 3292,
            amount: 0
        },
        av4.address
    );

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////          STEP 8: VAULT STAKING           //////////////////////////////////////
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
    ///////////////////////////////          STEP 9: STAKING CHECKPOINT           /////////////////////////////////////
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
    ///////////////////////////////              STEP 10: END STAKING              ////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////


    // Finish the program
    await hre.network.provider.send("evm_increaseTime", [18000]);

    // Repay all loans
    await token.connect(user1).approve(REPAYMENT_CONTROLLER, apeAmount.mul(2));
    await token.connect(user2).approve(REPAYMENT_CONTROLLER, apeAmount.mul(2));
    await token.connect(user3).approve(REPAYMENT_CONTROLLER, apeAmount.mul(2));
    await token.connect(user4).approve(REPAYMENT_CONTROLLER, apeAmount.mul(2));

    note1Id = await note.tokenOfOwnerByIndex(user1.address, 0);
    note2Id = await note.tokenOfOwnerByIndex(user2.address, 0);
    note3Id = await note.tokenOfOwnerByIndex(user3.address, 0);
    note4Id = await note.tokenOfOwnerByIndex(user4.address, 0);

    const rcFactory = await hre.ethers.getContractFactory("RepaymentController");
    const repaymentController = <RepaymentController>await rcFactory.attach(REPAYMENT_CONTROLLER);

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
    await staking.connect(user1).withdrawBAYC([{ tokenId: 3518, amount: apeAmount }], user1.address);
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
