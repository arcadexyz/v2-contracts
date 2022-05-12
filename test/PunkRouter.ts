import { expect } from "chai";
import hre, { upgrades, waffle } from "hardhat";
const { loadFixture } = waffle;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber } from "ethers";

import { VaultFactory, CallWhitelist, AssetVault, PunkRouter, CryptoPunksMarket, WrappedPunk } from "../typechain";
import { deploy } from "./utils/contracts";

type Signer = SignerWithAddress;

interface TestContext {
    vaultFactory: VaultFactory;
    punkRouter: PunkRouter;
    punks: CryptoPunksMarket;
    wrappedPunks: WrappedPunk;
    user: Signer;
    other: Signer;
    signers: Signer[];
}

interface TestContextForDepositStuck {
    owner: Signer;
    other: Signer;
    punks: CryptoPunksMarket;
    punkIndex: number;
    punkRouter: PunkRouter;
    vaultFactory: VaultFactory;
}

describe("PunkRouter", () => {
    /**
     * Sets up a test context, deploying new contracts and returning them for use in a test
     */
    const setupTestContext = async (): Promise<TestContext> => {
        const signers: Signer[] = await hre.ethers.getSigners();
        const punks = <CryptoPunksMarket>await deploy("CryptoPunksMarket", signers[0], []);
        const wrappedPunks = <WrappedPunk>await deploy("WrappedPunk", signers[0], [punks.address]);
        const whitelist = <CallWhitelist>await deploy("CallWhitelist", signers[0], []);
        const vaultTemplate = <AssetVault>await deploy("AssetVault", signers[0], []);

        const VaultFactoryFactory = await hre.ethers.getContractFactory("VaultFactory");
        const vaultFactory = <VaultFactory>(await upgrades.deployProxy(VaultFactoryFactory, [vaultTemplate.address, whitelist.address], { kind: 'uups', initializer: "initialize(address, address)" })
        );

        const punkRouter = <PunkRouter>(
            await deploy("PunkRouter", signers[0], [vaultFactory.address, wrappedPunks.address, punks.address])
        );

        return {
            vaultFactory,
            punks,
            wrappedPunks,
            punkRouter,
            user: signers[0],
            other: signers[1],
            signers: signers.slice(2),
        };
    };

    const setupTestContextForDepositStuck = async (): Promise<TestContextForDepositStuck> => {
        const { vaultFactory, punks, punkRouter, user, other } = await setupTestContext();
        const punkIndex = 1234;
        // claim ownership of punk
        await punks.setInitialOwner(await user.getAddress(), punkIndex);
        await punks.allInitialOwnersAssigned();
        // simulate depositPunk and stucked after buyPunk
        await punks.connect(user).transferPunk(punkRouter.address, punkIndex);
        return {
            owner: user,
            other,
            punkIndex,
            punks,
            punkRouter,
            vaultFactory
        };
    };

    /**
     * Initialize a new bundle, returning the bundleId
     */
    const initializeBundle = async (user: Signer): Promise<BigNumber> => {
        const { vaultFactory } = await loadFixture(setupTestContext);
        const tx = await vaultFactory.connect(user).initializeBundle(await user.getAddress());
        const receipt = await tx.wait();
        if (receipt && receipt.events) {
            for (const event of receipt.events) {
                if (event.event && event.event === "VaultCreated" && event.args && event.args.vault) {
                    return event.args.vault;
                }
            }
            throw new Error("Unable to initialize bundle");
        } else {
            throw new Error("Unable to initialize bundle");
        }
    };

    describe("Deposit CryptoPunk", function () {
        it("should successfully deposit a cryptopunk into bundle", async () => {
            const { punks, wrappedPunks, punkRouter, user } = await setupTestContext();
            const punkIndex = 1234;
            // claim ownership of punk
            await punks.setInitialOwner(await user.getAddress(), punkIndex);
            await punks.allInitialOwnersAssigned();
            // "approve" the punk to the router
            await punks.offerPunkForSaleToAddress(punkIndex, 0, punkRouter.address);

            const bundleId = await initializeBundle(user);
            await expect(punkRouter.depositPunk(punkIndex, bundleId))
                .to.emit(wrappedPunks, "Transfer")
                .withArgs(punkRouter.address, bundleId, punkIndex);

            expect(await wrappedPunks.ownerOf(punkIndex)).to.equal(bundleId);
        });

        // REQUIRE STATEMENT NEEDED for offerPunkForSaleToAddress function in
        // it("should fail if not approved", async () => {
        //     const { punks, punkRouter, user } = await setupTestContext();
        //     const punkIndex = 1234;
        //     // claim ownership of punk
        //     await punks.setInitialOwner(await user.getAddress(), punkIndex);
        //     await punks.allInitialOwnersAssigned();
        //     // skip "approving" the punk to the router

        //     const bundleId = await initializeBundle(user);
        //     await expect(punkRouter.depositPunk(punkIndex, bundleId)).to.be.reverted;
        // });

        it("should fail if not owner", async () => {
            const { punks, punkRouter, user, other } = await setupTestContext();
            const punkIndex = 1234;
            // claim ownership of punk
            await punks.setInitialOwner(await user.getAddress(), punkIndex);
            await punks.allInitialOwnersAssigned();
 console.log('----------------------------------------')


console.log('----------------------------------------')
            // "approve" the punk to the router
            await punks.offerPunkForSaleToAddress(punkIndex, 0, punkRouter.address);
            const bundleId = await initializeBundle(user);
console.log('---------------------------------------- bundleId', bundleId)
            await expect(punkRouter.connect(other).depositPunk(punkIndex, bundleId)).to.be.revertedWith(
                "PunkRouter: not owner",)

        });
    });

    describe("Withdraw CryptoPunk held by PunkRouter", function () {
        it("should successfully withdraw punk", async () => {
            const { punks, punkRouter, other, punkIndex } = await setupTestContextForDepositStuck();
            await expect(punkRouter.withdrawPunk(punkIndex, other.address))
                .to.emit(punks, "Transfer")
                .withArgs(punkRouter.address, other.address, 1)
                .to.emit(punks, "PunkTransfer")
                .withArgs(punkRouter.address, other.address, punkIndex);
        });

        it("should fail if not designated admin", async () => {
            const { punkRouter, owner, other, punkIndex } = await setupTestContextForDepositStuck();
            await expect(punkRouter.connect(other).withdrawPunk(punkIndex, owner.address)).to.be.revertedWith(
                "Ownable: caller is not the owner",
            );
        });
    });
});
