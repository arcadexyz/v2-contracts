/* eslint no-unused-vars: 0 */

import hre, { ethers, upgrades } from "hardhat";
import { ApeCoinStaking, AssetVault, CallWhitelistApprovals, MockERC20, OriginationController, VaultFactory } from "../typechain";

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
    const APE = "0x4d224452801ACEd8B2F0aebE155379bb5D594381";
    const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";
    const MAYC = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6";
    const BAKC = "0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623";
    const WHALE = "0x54BE3a794282C030b15E43aE2bB182E14c409C5e";
    const OWNER = "0xA2852f6E66cbA2A69685da5cB0A7e48dB8b3E05a";

    const ORIGINATION_CONTROLLER = "0x4c52ca29388A8A854095Fd2BeB83191D68DC840b";
    const ARCADE_MSIG = "0x398e92C827C5FA0F33F171DC8E20570c5CfF330e";

    const [user1, user2, user3, user4, lender] = await ethers.getSigners();

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [WHALE],
    });

    const whale = await hre.ethers.getSigner(WHALE);

    console.log("Distributing ApeCoin...");

    const factory20 = await ethers.getContractFactory("ERC20");
    const ape = await factory20.attach(APE);

    console.log("Distributing NFTs...");

    const factory721 = await ethers.getContractFactory("ERC721");
    const bayc = await factory721.attach(BAYC);
    const mayc = await factory721.attach(MAYC);
    const bakc = await factory721.attach(BAKC);

    // Send APE to users
    await ape.connect(whale).transfer(user1.address, ethers.utils.parseEther("100000"));
    await ape.connect(whale).transfer(user2.address, ethers.utils.parseEther("100000"));
    await ape.connect(whale).transfer(user3.address, ethers.utils.parseEther("100000"));
    await ape.connect(whale).transfer(user4.address, ethers.utils.parseEther("100000"));
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
        startTime + 3600,
        ethers.utils.parseEther("10000")
    );

    await staking.connect(owner).addTimeRange(
        2,
        ethers.utils.parseEther("25000"),
        startTime,
        startTime + 3600,
        ethers.utils.parseEther("10000")
    );

    await staking.connect(owner).addTimeRange(
        3,
        ethers.utils.parseEther("25000"),
        startTime,
        startTime + 3600,
        ethers.utils.parseEther("10000")
    );

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

    const vaultTemplate = await hre.ethers.getContractFactory("AssetVault");
    const template = <AssetVault>await vaultTemplate.deploy();
    const vfFactory = await hre.ethers.getContractFactory("VaultFactory");
    const factory = <VaultFactory>await upgrades.deployProxy(
        vfFactory,
        [template.address, whitelist.address],
        { kind: "uups" },
    );

    const ocFactory = await hre.ethers.getContractFactory("OriginationController");
    const originationController = <OriginationController>await ocFactory.attach(ORIGINATION_CONTROLLER);

    const makeTerms = (vault: AssetVault): LoanTerms => ({
        durationSecs: 86_400,
        principal: ethers.utils.parseEther("10"),
        interestRate: ethers.utils.parseEther("1"),
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

    console.log("Performing Asset Vault approvals...");

    // Vaults are live - try to stake apecoin from the vault using "call"
    const apeAmount = ethers.utils.parseEther("100");

    await ape.connect(user1).transfer(av1.address, apeAmount);
    await ape.connect(user2).transfer(av2.address, apeAmount);
    await ape.connect(user3).transfer(av3.address, apeAmount);
    await ape.connect(user4).transfer(av4.address, apeAmount);

    await av1.connect(user1).callApprove(ape.address, staking.address, apeAmount);
    await av2.connect(user2).callApprove(ape.address, staking.address, apeAmount);
    await av3.connect(user3).callApprove(ape.address, staking.address, apeAmount);
    await av4.connect(user4).callApprove(ape.address, staking.address, apeAmount);

    console.log("Performing staking operation...");

    const cd1 = staking.interface.encodeFunctionData("depositBAYC", [
        [{ tokenId: 3518, amount: apeAmount }]
    ]);

    const cd2 = staking.interface.encodeFunctionData("depositMAYC", [
        [{ tokenId: 11706, amount: apeAmount }]
    ]);

    const cd3 = staking.interface.encodeFunctionData("depositBAKC", [
        [{ mainTokenId: 1044, bakcTokenId: 6037, amount: apeAmount }],
        []
    ]);

    const cd4 = staking.interface.encodeFunctionData("depositBAKC", [
        [],
        [{ mainTokenId: 21026, bakcTokenId: 3292, amount: apeAmount }]
    ]);

    await av1.connect(user1).call(staking.address, cd1);
    await av2.connect(user2).call(staking.address, cd2);
    await av3.connect(user3).call(staking.address, cd3);
    await av4.connect(user4).call(staking.address, cd4);

    console.log("Accruing staking rewards...");

    // Go through half of program
    await hre.network.provider.send("evm_increaseTime", [1800]);
    await hre.network.provider.send("evm_mine");

    const pr1 = await staking.pendingRewards(1, av1.address, 3518);
    const pr2 = await staking.pendingRewards(2, av2.address, 11706);
    const pr3 = await staking.pendingRewards(3, av3.address, 6037);
    const pr4 = await staking.pendingRewards(3, av4.address, 3292);

    console.log("Pending Rewards User 1:", pr1.toString());
    console.log("Pending Rewards User 2:", pr2.toString());
    console.log("Pending Rewards User 3:", pr3.toString());
    console.log("Pending Rewards User 4:", pr4.toString());


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
