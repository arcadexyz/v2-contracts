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

    describe("Deposits", () => {
        let ctx: TestContext;

        beforeEach(async () => {
            ctx = await loadFixture(fixture);

            // Approve the router to make reports for the user
            const { reporter, user, router, vault } = ctx;

            await reporter.connect(user).setApproval(vault.address, router.address);
        });

        it("should not accept a deposit for the zero address", async () => {
            const { mockERC20, user, router } = ctx;
            const amount = hre.ethers.utils.parseUnits("50", 18);

            await mint(mockERC20, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC20.connect(user).approve(router.address, amount);

            // Reporter address not a valid vault
            await expect(
                router.connect(user).depositERC20(ZERO_ADDRESS, mockERC20.address, amount)
            ).to.be.revertedWith("VOC_ZeroAddress");
        });

        it("should not accept a deposit for a vault that does not exist", async () => {
            const { mockERC20, user, router, reporter } = ctx;
            const amount = hre.ethers.utils.parseUnits("50", 18);

            await mint(mockERC20, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC20.connect(user).approve(router.address, amount);

            // Reporter address not a valid vault
            await expect(
                router.connect(user).depositERC20(reporter.address, mockERC20.address, amount)
            ).to.be.revertedWith("VOC_InvalidVault");
        });

        it("should not accept a deposit if the user is not the owner of a vault", async () => {
            const { vault, mockERC20, user, other, router } = ctx;
            const amount = hre.ethers.utils.parseUnits("50", 18);

            await mint(mockERC20, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC20.connect(user).approve(router.address, amount);

            // Reporter address not a valid vault
            await expect(
                router.connect(other).depositERC20(vault.address, mockERC20.address, amount)
            ).to.be.revertedWith("VOC_NotOwnerOrApproved");
        });

        it("should accept a deposit if the depositor has an approval from the owner", async () => {
            const { nft, vault, mockERC20, user, other, router, reporter } = ctx;
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

        it("should accept deposit of an ERC20 token and report inventory", async () => {
            const { vault, mockERC20, user, router, reporter } = ctx;
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

        it("should accept deposit of an ERC721 token and report inventory", async () => {
            const { vault, mockERC721, user, router, reporter } = ctx;

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

        it("should accept deposit of an ERC1155 token and report inventory", async () => {
            const { vault, mockERC1155, user, router, reporter } = ctx;
            const amount = hre.ethers.utils.parseUnits("50", 18);

            const tokenId = await mintERC1155(mockERC1155, user, amount);
            // approve router to send ERC1155 tokens in
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

        it("should accept deposit of a CryptoPunk and report inventory", async () => {
            const { vault, punks, user, router, reporter } = ctx;

            const tokenId = 8888;
            await punks.setInitialOwner(user.address, tokenId);
            await punks.allInitialOwnersAssigned();

            // approve router to send a punk in
            await punks.connect(user).offerPunkForSaleToAddress(tokenId, 0, router.address);
            await router.connect(user).depositPunk(vault.address, punks.address, tokenId);

            expect(await punks.balanceOf(vault.address)).to.equal(1);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(1);
            expect(items[0].tokenAddress).to.eq(punks.address);
            expect(items[0].tokenId).to.eq(tokenId);
        });

        it("should accept deposit of an ERC20 token batch and report inventory", async () => {
            const { vault, mockERC20, user, router, reporter } = ctx;
            const amount = hre.ethers.utils.parseUnits("50", 18);

            const otherMockERC20 = <MockERC20>await deploy("MockERC20", user, ["Mock ERC20", "MOCK"]);

            await mint(mockERC20, user, amount);
            await mint(otherMockERC20, user, amount.div(2));
            // approve router to send ERC20 tokens in
            await mockERC20.connect(user).approve(router.address, amount);
            await otherMockERC20.connect(user).approve(router.address, amount);

            await expect(
                router.connect(user).depositERC20Batch(
                    vault.address,
                    [mockERC20.address, otherMockERC20.address],
                    [amount]
                )
            ).to.be.revertedWith("VDR_BatchLengthMismatch");

            await router.connect(user).depositERC20Batch(
                vault.address,
                [mockERC20.address, otherMockERC20.address],
                [amount, amount.div(2)]
            );

            expect(await mockERC20.balanceOf(vault.address)).to.equal(amount);
            expect(await otherMockERC20.balanceOf(vault.address)).to.equal(amount.div(2));

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(2);
            expect(items[0].tokenAddress).to.eq(mockERC20.address);
            expect(items[0].tokenAmount).to.eq(amount);
            expect(items[1].tokenAddress).to.eq(otherMockERC20.address);
            expect(items[1].tokenAmount).to.eq(amount.div(2));
        });

        it("should accept deposit of an ERC721 token batch and report inventory", async () => {
            const { vault, mockERC721, user, router, reporter } = ctx;

            const otherMockERC721 = <MockERC721>await deploy("MockERC721", user, ["Mock ERC721", "MOCK"]);

            const tokenId = await mintERC721(mockERC721, user);
            const tokenId2 = await mintERC721(otherMockERC721, user);
            const tokenId3 = await mintERC721(mockERC721, user);

            // approve router to send ERC721 tokens in
            await mockERC721.connect(user).setApprovalForAll(router.address, true);
            await otherMockERC721.connect(user).approve(router.address, tokenId2);

            await expect(
                router.connect(user).depositERC721Batch(
                    vault.address,
                    [mockERC721.address, otherMockERC721.address, mockERC721.address],
                    [tokenId, tokenId2]
                )
            ).to.be.revertedWith("VDR_BatchLengthMismatch");

            await router.connect(user).depositERC721Batch(
                vault.address,
                [mockERC721.address, otherMockERC721.address, mockERC721.address],
                [tokenId, tokenId2, tokenId3]
            );

            expect(await mockERC721.balanceOf(vault.address)).to.equal(2);
            expect(await mockERC721.ownerOf(tokenId)).to.equal(vault.address);
            expect(await mockERC721.ownerOf(tokenId3)).to.equal(vault.address);
            expect(await otherMockERC721.balanceOf(vault.address)).to.equal(1);
            expect(await otherMockERC721.ownerOf(tokenId2)).to.equal(vault.address);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(3);
            expect(items[0].tokenAddress).to.eq(mockERC721.address);
            expect(items[0].tokenId).to.eq(tokenId);
            expect(items[1].tokenAddress).to.eq(otherMockERC721.address);
            expect(items[1].tokenId).to.eq(tokenId2);
            expect(items[2].tokenAddress).to.eq(mockERC721.address);
            expect(items[2].tokenId).to.eq(tokenId3);
        });

        it("should accept deposit of an ERC1155 token batch and report inventory", async () => {
            const { vault, mockERC1155, user, router, reporter } = ctx;
            const amount = hre.ethers.utils.parseUnits("50", 18);

            const otherMockERC1155 = <MockERC1155>await deploy("MockERC1155", user, []);

            const tokenId = await mintERC1155(mockERC1155, user, amount);
            const tokenId2 = await mintERC1155(otherMockERC1155, user, amount);
            const tokenId3 = await mintERC1155(mockERC1155, user, amount);

            // approve router to send ERC1155 tokens in
            await mockERC1155.connect(user).setApprovalForAll(router.address, true);
            await otherMockERC1155.connect(user).setApprovalForAll(router.address, true);

            await expect(
                router.connect(user).depositERC1155Batch(
                    vault.address,
                    [mockERC1155.address, otherMockERC1155.address, mockERC1155.address],
                    [tokenId, tokenId2, tokenId3],
                    [amount, amount]
                )
            ).to.be.revertedWith("VDR_BatchLengthMismatch");

            await expect(
                router.connect(user).depositERC1155Batch(
                    vault.address,
                    [mockERC1155.address, otherMockERC1155.address, mockERC1155.address],
                    [tokenId2, tokenId3],
                    [amount, amount, amount]
                )
            ).to.be.revertedWith("VDR_BatchLengthMismatch");

            await expect(
                router.connect(user).depositERC1155Batch(
                    vault.address,
                    [mockERC1155.address, otherMockERC1155.address],
                    [tokenId, tokenId2, tokenId3],
                    [amount, amount, amount]
                )
            ).to.be.revertedWith("VDR_BatchLengthMismatch");


            await router.connect(user).depositERC1155Batch(
                vault.address,
                [mockERC1155.address, otherMockERC1155.address, mockERC1155.address],
                [tokenId, tokenId2, tokenId3],
                [amount, amount, amount]
            );

            expect(await mockERC1155.balanceOf(vault.address, tokenId)).to.equal(amount);
            expect(await mockERC1155.balanceOf(vault.address, tokenId3)).to.equal(amount);
            expect(await otherMockERC1155.balanceOf(vault.address, tokenId2)).to.equal(amount);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(3);
            expect(items[0].tokenAddress).to.eq(mockERC1155.address);
            expect(items[0].tokenId).to.eq(tokenId);
            expect(items[0].tokenAmount).to.eq(amount);
            expect(items[1].tokenAddress).to.eq(otherMockERC1155.address);
            expect(items[1].tokenId).to.eq(tokenId2);
            expect(items[1].tokenAmount).to.eq(amount);
            expect(items[2].tokenAddress).to.eq(mockERC1155.address);
            expect(items[2].tokenId).to.eq(tokenId3);
            expect(items[2].tokenAmount).to.eq(amount);
        });

        it("should accept deposit of a CryptoPunk batch and report inventory", async () => {
            const { vault, punks, user, router, reporter } = ctx;

            const tokenId = 8888;
            const tokenId2 = 5555;
            await punks.setInitialOwner(user.address, tokenId);
            await punks.setInitialOwner(user.address, tokenId2);
            await punks.allInitialOwnersAssigned();

            // approve router to send a punk in
            await punks.connect(user).offerPunkForSaleToAddress(tokenId, 0, router.address);
            await punks.connect(user).offerPunkForSaleToAddress(tokenId2, 0, router.address);

            await expect(
                router.connect(user).depositPunkBatch(
                    vault.address,
                    [punks.address],
                    [tokenId, tokenId2]
                )
            ).to.be.revertedWith("VDR_BatchLengthMismatch");

            await router.connect(user).depositPunkBatch(
                vault.address,
                [punks.address, punks.address],
                [tokenId, tokenId2]
            );

            expect(await punks.balanceOf(vault.address)).to.equal(2);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(2);
            expect(items[0].tokenAddress).to.eq(punks.address);
            expect(items[0].tokenId).to.eq(tokenId);
            expect(items[1].tokenAddress).to.eq(punks.address);
            expect(items[1].tokenId).to.eq(tokenId2);
        });
    });
});
