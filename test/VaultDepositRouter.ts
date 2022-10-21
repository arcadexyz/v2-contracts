import chai, { expect } from "chai";
import hre, { ethers, waffle, upgrades } from "hardhat";
import { solidity } from "ethereum-waffle";
const { loadFixture } = waffle;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber, BigNumberish } from "ethers";

chai.use(solidity);

import {
    AssetVault,
    CallWhitelist,
    VaultFactory,
    MockCallDelegator,
    MockERC20,
    MockERC721,
    MockERC1155,
    CryptoPunksMarket,
    VaultInventoryReporter,
    VaultDepositRouter
} from "../typechain";
import { mint, ZERO_ADDRESS } from "./utils/erc20";
import { mint as mintERC721 } from "./utils/erc721";
import { mint as mintERC1155 } from "./utils/erc1155";
import { deploy } from "./utils/contracts";

type Signer = SignerWithAddress;

interface TestContext {
    vault: AssetVault;
    vaultTemplate: AssetVault;
    nft: VaultFactory;
    whitelist: CallWhitelist;
    bundleId: BigNumberish;
    mockERC20: MockERC20;
    mockERC721: MockERC721;
    mockERC1155: MockERC1155;
    punks: CryptoPunksMarket;
    reporter: VaultInventoryReporter;
    router: VaultDepositRouter;
    user: Signer;
    other: Signer;
    signers: Signer[];
}

describe("VaultDepositRouter", () => {
    /**
     * Creates a vault instance using the vault factory
     */
    const createVault = async (factory: VaultFactory, user: Signer): Promise<AssetVault> => {
        const tx = await factory.connect(user).initializeBundle(await user.getAddress());
        const receipt = await tx.wait();

        let vault: AssetVault | undefined;
        if (receipt && receipt.events) {
            for (const event of receipt.events) {
                if (event.args && event.args.vault) {
                    vault = <AssetVault>await hre.ethers.getContractAt("AssetVault", event.args.vault);
                }
            }
        } else {
            throw new Error("Unable to create new vault");
        }
        if (!vault) {
            throw new Error("Unable to create new vault");
        }
        return vault;
    };

    /**
     * Sets up a test context, deploying new contracts and returning them for use in a test
     */
    const fixture = async (): Promise<TestContext> => {
        const signers: Signer[] = await hre.ethers.getSigners();
        const whitelist = <CallWhitelist>await deploy("CallWhitelist", signers[0], []);
        const mockERC20 = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);
        const mockERC721 = <MockERC721>await deploy("MockERC721", signers[0], ["Mock ERC721", "MOCK"]);
        const mockERC1155 = <MockERC1155>await deploy("MockERC1155", signers[0], []);

        const vaultTemplate = <AssetVault>await deploy("AssetVault", signers[0], []);
        const VaultFactoryFactory = await hre.ethers.getContractFactory("VaultFactory");
        const factory = <VaultFactory>await upgrades.deployProxy(
            VaultFactoryFactory,
            [vaultTemplate.address, whitelist.address],
            {
                kind: "uups",
            },
        );
        const vault = await createVault(factory, signers[0]);

        const punks = <CryptoPunksMarket>await deploy("CryptoPunksMarket", signers[0], []);

        const reporter = <VaultInventoryReporter>await deploy("VaultInventoryReporter", signers[0], []);
        const router = <VaultDepositRouter>await deploy("VaultDepositRouter", signers[0], [factory.address, reporter.address]);

        return {
            nft: factory,
            vault,
            vaultTemplate,
            whitelist,
            bundleId: vault.address,
            mockERC20,
            mockERC721,
            mockERC1155,
            user: signers[0],
            other: signers[1],
            signers: signers.slice(2),
            punks,
            reporter,
            router
        };
    };

    describe("Deployment", () => {
        it("should fail to deploy if deployed without a factory", async () => {
            const { reporter } = await loadFixture(fixture);

            const factory = await hre.ethers.getContractFactory("VaultDepositRouter");

            await expect(factory.deploy(ZERO_ADDRESS, reporter.address)).to.be.revertedWith("VDR_ZeroAddress");
        });

        it("should fail to deploy if deployed without a reporter", async () => {
            const { nft } = await loadFixture(fixture);

            const factory = await hre.ethers.getContractFactory("VaultDepositRouter");

            await expect(factory.deploy(nft.address, ZERO_ADDRESS)).to.be.revertedWith("VDR_ZeroAddress");
        });
    });

    describe.only("Deposits", () => {
        it("should not accept a deposit for the zero address", async () => {
            const { mockERC20, user, router } = await loadFixture(fixture);
            const amount = hre.ethers.utils.parseUnits("50", 18);

            await mint(mockERC20, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC20.connect(user).approve(router.address, amount);

            // Reporter address not a valid vault
            await expect(
                router.connect(user).depositERC20(ZERO_ADDRESS, mockERC20.address, amount)
            ).to.be.revertedWith("VDR_ZeroAddress");
        });

        it("should not accept a deposit for a vault that does not exist", async () => {
            const { mockERC20, user, router, reporter } = await loadFixture(fixture);
            const amount = hre.ethers.utils.parseUnits("50", 18);

            await mint(mockERC20, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC20.connect(user).approve(router.address, amount);

            // Reporter address not a valid vault
            await expect(
                router.connect(user).depositERC20(reporter.address, mockERC20.address, amount)
            ).to.be.revertedWith("VDR_InvalidVault");
        });

        it("should not accept a deposit if the user is not the owner of a vault", async () => {
            const { vault, mockERC20, user, other, router } = await loadFixture(fixture);
            const amount = hre.ethers.utils.parseUnits("50", 18);

            await mint(mockERC20, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC20.connect(user).approve(router.address, amount);

            // Reporter address not a valid vault
            await expect(
                router.connect(other).depositERC20(vault.address, mockERC20.address, amount)
            ).to.be.revertedWith("VDR_NotOwnerOrApproved");
        });

        it("should accept a deposit if the depositor has an approval from the owner", async () => {
            const { nft, vault, mockERC20, user, other, router, reporter } = await loadFixture(fixture);
            const amount = hre.ethers.utils.parseUnits("50", 18);

            await mint(mockERC20, other, amount);
            // approve router to send ERC20 tokens in
            await mockERC20.connect(other).approve(router.address, amount);
            await nft.connect(user).approve(other.address, vault.address);
            await router.connect(other).depositERC20(vault.address, mockERC20.address, amount);

            expect(await mockERC20.balanceOf(vault.address)).to.equal(amount);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(1);
            expect(items[0].tokenAddress).to.eq(mockERC20.address);
            expect(items[0].tokenAmount).to.eq(amount);
        });

        it("should accept deposit from an ERC20 token and report inventory", async () => {
            const { vault, mockERC20, user, router, reporter } = await loadFixture(fixture);
            const amount = hre.ethers.utils.parseUnits("50", 18);

            await mint(mockERC20, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC20.connect(user).approve(router.address, amount);
            await router.connect(user).depositERC20(vault.address, mockERC20.address, amount);

            expect(await mockERC20.balanceOf(vault.address)).to.equal(amount);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(1);
            expect(items[0].tokenAddress).to.eq(mockERC20.address);
            expect(items[0].tokenAmount).to.eq(amount);
        });

        it("should accept deposit from an ERC721 token and report inventory", async () => {
            const { vault, mockERC721, user, router, reporter } = await loadFixture(fixture);

            const tokenId = await mintERC721(mockERC721, user);

            // approve router to send ERC721 tokens in
            await mockERC721.connect(user).approve(router.address, tokenId);
            await router.connect(user).depositERC721(vault.address, mockERC721.address, tokenId);

            expect(await mockERC721.balanceOf(vault.address)).to.equal(1);
            expect(await mockERC721.ownerOf(tokenId)).to.equal(vault.address);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(1);
            expect(items[0].tokenAddress).to.eq(mockERC721.address);
            expect(items[0].tokenId).to.eq(tokenId);
        });

        it("should accept deposit from an ERC1155 token and report inventory", async () => {
            const { vault, mockERC1155, user, router, reporter } = await loadFixture(fixture);
            const amount = hre.ethers.utils.parseUnits("50", 18);

            const tokenId = await mintERC1155(mockERC1155, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC1155.connect(user).setApprovalForAll(router.address, true);
            await router.connect(user).depositERC1155(vault.address, mockERC1155.address, tokenId, amount);

            expect(await mockERC1155.balanceOf(vault.address, tokenId)).to.equal(amount);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(1);
            expect(items[0].tokenAddress).to.eq(mockERC1155.address);
            expect(items[0].tokenId).to.eq(tokenId);
            expect(items[0].tokenAmount).to.eq(amount);
        });
    });
});
