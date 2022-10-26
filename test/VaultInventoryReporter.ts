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
    VaultInventoryReporter
} from "../typechain";
import { mintToAddress as mintERC721 } from "./utils/erc721";
import { mintToAddress as mintERC1155 } from "./utils/erc1155";
import { deploy } from "./utils/contracts";
import { createInventoryPermitSignature, InventoryPermitData } from "./utils/eip712";

type Signer = SignerWithAddress;

const ERC_721_ITEM_TYPE = 0;
const ERC_1155_ITEM_TYPE = 1;
const ERC_20_ITEM_TYPE = 2;
const PUNKS_ITEM_TYPE = 3;

const maxDeadline = hre.ethers.constants.MaxUint256;
const NAME = "VR1";

const hashItem = (item: Item) => {
    const types = ["address", "uint256", "uint256"];
    const values = [item.tokenAddress, item.tokenId, item.tokenAmount];

    return ethers.utils.solidityKeccak256(types, values);
}

interface Item {
    itemType: BigNumberish;
    tokenAddress: string;
    tokenId: BigNumberish;
    tokenAmount: BigNumberish;
}
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
    user: Signer;
    other: Signer;
    signers: Signer[];
}

describe("VaultInventoryReporter", () => {
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

        const reporter = <VaultInventoryReporter>await deploy("VaultInventoryReporter", signers[0], [NAME]);

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
            reporter
        };
    };

    describe("Inventory Operations", () => {
        describe("add", () => {
            let ctx: TestContext;
            let amount20: BigNumberish;
            let id721: BigNumberish;
            let id1155: BigNumberish;
            let amount1155: BigNumberish;
            let idPunk: BigNumberish;

            beforeEach(async () => {
                // before - mint some NFTs and transfer to vault
                ctx = await loadFixture(fixture);

                const { vault, mockERC20, mockERC721, mockERC1155, punks } = ctx;

                amount20 = ethers.utils.parseEther("100");
                await mockERC20.mint(vault.address, amount20);

                id721 = await mintERC721(mockERC721, vault.address);

                amount1155 = ethers.BigNumber.from(10);
                id1155 = await mintERC1155(mockERC1155, vault.address, amount1155 as BigNumber);

                idPunk = 8888;
                await punks.setInitialOwner(vault.address, idPunk);
                await punks.allInitialOwnersAssigned();
            });

            it("should revert if attempting to add zero items", async () => {
                const { reporter, user, vault } = ctx;

                await expect(
                    reporter.connect(user).add(vault.address, [])
                ).to.be.revertedWith("VIR_NoItems");
            });

            it("should revert if attempting to add more items than the maximum", async () => {
                const { reporter, user, vault, mockERC20 } = ctx;

                const item: Item = {
                    itemType: ERC_20_ITEM_TYPE,
                    tokenAddress: mockERC20.address,
                    tokenId: 0,
                    tokenAmount: amount20
                };

                // Create a vault of 51 items.
                const items = (Array(51) as Item[]).fill(item, 0, 51);

                await expect(
                    reporter.connect(user).add(vault.address, items)
                ).to.be.revertedWith("VIR_TooManyItems");
            });

            it("should revert if the caller is not the vault's owner or approved", async () => {
                const { reporter, other, vault, mockERC20 } = ctx;

                const item: Item = {
                    itemType: ERC_20_ITEM_TYPE,
                    tokenAddress: mockERC20.address,
                    tokenId: 0,
                    tokenAmount: amount20
                };

                const items = [item];

                await expect(
                    reporter.connect(other).add(vault.address, items)
                ).to.be.revertedWith("VIR_NotApproved");
            });

            it("should revert if not enough ERC20 tokens are held by the vault", async () => {
                const { reporter, user, vault, mockERC20 } = ctx;

                const item: Item = {
                    itemType: ERC_20_ITEM_TYPE,
                    tokenAddress: mockERC20.address,
                    tokenId: 0,
                    tokenAmount: (amount20 as BigNumber).mul(2) // more than the vault owns
                };

                const items = [item];

                await expect(
                    reporter.connect(user).add(vault.address, items)
                ).to.be.revertedWith("VIR_NotVerified");
            });

            it("should revert if the specified ERC721 is not held by the vault", async () => {
                const { reporter, user, vault, mockERC721 } = ctx;

                // Mint a different 721
                const tokenId2 = await mintERC721(mockERC721, user.address);

                const item: Item = {
                    itemType: ERC_721_ITEM_TYPE,
                    tokenAddress: mockERC721.address,
                    tokenId: tokenId2, // Different tokenID than vault owns
                    tokenAmount: 0
                };

                const items = [item];

                await expect(
                    reporter.connect(user).add(vault.address, items)
                ).to.be.revertedWith("VIR_NotVerified");
            });

            it("should revert if not enough of the specified ERC1155 tokens are not held by the vault", async () => {
                const { reporter, user, vault, mockERC1155 } = ctx;

                const item: Item = {
                    itemType: ERC_1155_ITEM_TYPE,
                    tokenAddress: mockERC1155.address,
                    tokenId: (id1155 as BigNumber).add(1), // Different tokenID than minted
                    tokenAmount: amount1155
                };

                const items = [item];

                await expect(
                    reporter.connect(user).add(vault.address, items)
                ).to.be.revertedWith("VIR_NotVerified");

                // Try again after using right token ID, but changing amount
                item.tokenId = id1155;
                item.tokenAmount = (amount1155 as BigNumber).mul(2);

                await expect(
                    reporter.connect(user).add(vault.address, items)
                ).to.be.revertedWith("VIR_NotVerified");
            });

            it("should revert if the specified punk is not held by the vault", async () => {
                const { reporter, user, vault, punks } = ctx;

                const item: Item = {
                    itemType: PUNKS_ITEM_TYPE,
                    tokenAddress: punks.address,
                    tokenId: (idPunk as number) + 1, // Different tokenID than vault owns
                    tokenAmount: 0
                };

                const items = [item];

                await expect(
                    reporter.connect(user).add(vault.address, items)
                ).to.be.revertedWith("VIR_NotVerified");
            });

            it("should allow the vault owner to add items to inventory", async () => {
                const { reporter, user, vault, punks, mockERC1155, mockERC20, mockERC721 } = ctx;

                const items: Item[] = [
                    {
                        itemType: ERC_20_ITEM_TYPE,
                        tokenAddress: mockERC20.address,
                        tokenId: 0,
                        tokenAmount: amount20
                    },
                    {
                        itemType: ERC_721_ITEM_TYPE,
                        tokenAddress: mockERC721.address,
                        tokenId: id721,
                        tokenAmount: 0
                    },
                    {
                        itemType: ERC_1155_ITEM_TYPE,
                        tokenAddress: mockERC1155.address,
                        tokenId: id1155,
                        tokenAmount: amount1155
                    },
                    {
                        itemType: PUNKS_ITEM_TYPE,
                        tokenAddress: punks.address,
                        tokenId: idPunk,
                        tokenAmount: 0
                    }
                ];

                await expect(
                    reporter.connect(user).add(vault.address, items)
                ).to.emit(reporter, "Add")
                    .withArgs(vault.address, user.address, hashItem(items[0]))
                    .to.emit(reporter, "Add")
                    .withArgs(vault.address, user.address, hashItem(items[1]))
                    .to.emit(reporter, "Add")
                    .withArgs(vault.address, user.address, hashItem(items[2]))
                    .to.emit(reporter, "Add")
                    .withArgs(vault.address, user.address, hashItem(items[3]));
            });

            it("should allow an approved address to add items to inventory", async () => {
                const { reporter, user, other, vault, punks, mockERC1155, mockERC20, mockERC721 } = ctx;

                await reporter.connect(user).setApproval(vault.address, other.address);

                const items: Item[] = [
                    {
                        itemType: ERC_20_ITEM_TYPE,
                        tokenAddress: mockERC20.address,
                        tokenId: 0,
                        tokenAmount: amount20
                    },
                    {
                        itemType: ERC_721_ITEM_TYPE,
                        tokenAddress: mockERC721.address,
                        tokenId: id721,
                        tokenAmount: 0
                    },
                    {
                        itemType: ERC_1155_ITEM_TYPE,
                        tokenAddress: mockERC1155.address,
                        tokenId: id1155,
                        tokenAmount: amount1155
                    },
                    {
                        itemType: PUNKS_ITEM_TYPE,
                        tokenAddress: punks.address,
                        tokenId: idPunk,
                        tokenAmount: 0
                    }
                ];

                await expect(
                    reporter.connect(other).add(vault.address, items)
                ).to.emit(reporter, "Add")
                    .withArgs(vault.address, other.address, hashItem(items[0]))
                    .to.emit(reporter, "Add")
                    .withArgs(vault.address, other.address, hashItem(items[1]))
                    .to.emit(reporter, "Add")
                    .withArgs(vault.address, other.address, hashItem(items[2]))
                    .to.emit(reporter, "Add")
                    .withArgs(vault.address, other.address, hashItem(items[3]));
            });

            it("should not allow an address to add items to inventory with an invalid permit signature");
            it("should not allow an address to add items to inventory with an expired permit signature");
            it("should allow an address to add items to inventory with a permit signature from the owner", async () => {
                const { reporter, user, other, vault, punks, mockERC1155, mockERC20, mockERC721 } = ctx;

                const deadline = maxDeadline;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 1,
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                const items: Item[] = [
                    {
                        itemType: ERC_20_ITEM_TYPE,
                        tokenAddress: mockERC20.address,
                        tokenId: 0,
                        tokenAmount: amount20
                    },
                    {
                        itemType: ERC_721_ITEM_TYPE,
                        tokenAddress: mockERC721.address,
                        tokenId: id721,
                        tokenAmount: 0
                    },
                    {
                        itemType: ERC_1155_ITEM_TYPE,
                        tokenAddress: mockERC1155.address,
                        tokenId: id1155,
                        tokenAmount: amount1155
                    },
                    {
                        itemType: PUNKS_ITEM_TYPE,
                        tokenAddress: punks.address,
                        tokenId: idPunk,
                        tokenAmount: 0
                    }
                ];

                await expect(
                    reporter.connect(other).addWithPermit(vault.address, items, deadline, sig.v, sig.r, sig.s)
                ).to.emit(reporter, "Add")
                    .withArgs(vault.address, other.address, hashItem(items[0]))
                    .to.emit(reporter, "Add")
                    .withArgs(vault.address, other.address, hashItem(items[1]))
                    .to.emit(reporter, "Add")
                    .withArgs(vault.address, other.address, hashItem(items[2]))
                    .to.emit(reporter, "Add")
                    .withArgs(vault.address, other.address, hashItem(items[3]));
            });
        });

        describe("remove", () => {
            // before - mint some NFTs and register some inventory

            it("should revert if attempting to remove zero items");
            it("should revert if attempting to remove more items than the maximum");
            it("should revert if the caller is not the vault's owner or approved");
            it("should allow the vault owner to remove items from inventory");
            it("should allow an approved address to remove items from inventory");
            it("should not revert if a specified item is not registered in inventory");
            it("should not allow an address to remove items from inventory with an invalid permit signature");
            it("should not allow an address to remove items from inventory with an expired permit signature");
            it("should allow an address to remove items from inventory with a permit signature from the owner");
        });

        describe("clear", () => {
            // before - mint some NFTs and register some inventory

            it("should revert if the vault's registered inventory is larger than the maximum items per update");
            it("should revert if the caller is not the vault's owner or approved");
            it("should allow the vault owner to clear inventory");
            it("should allow an approved address to clear inventory");
            it("should not allow an address to clear inventory with an invalid permit signature");
            it("should not allow an address to clear inventory with an expired permit signature");
            it("should allow an address to clear inventory with a permit signature from the owner");
        });
    });

    describe("Verification", () => {
        // Before - mint some NFTs and register some inventory

        it("should verify all items in a vault's inventory are currently held");
        it("should return false if all items in a vault's inventory are not owned by the vault");
        it("should verify whether a specific item in a vault's inventory is currently held");
        it("should revert if a specific item submitted for verification is not in the registered inventory");
        it("should return false if a specific item in a vault's inventory is not owned by the vault");
    });

    describe("Enumeration", () => {
        // Before - mint some NFTs and register some inventory

        it("should enumerate all items in a vault, without checking staleness");
        it("should enumerate all items in a vault, checking for staleness");
        it("should revert on enumerateOrFail if inventory is stale");
        it("should report all item hashes for a vault's inventory");
        it("should report a specific item hash for a vault's inventory");
        it("should report a specific item for a vault's inventory");
    });

    describe("Permissions", () => {
        it("should not allow a user who is not owner or approved for a vault to set reporting approval");
        it("should allow a vault owner to set reporting approval");
        it("should allow a vault owner to remove all reporting approval");
        it("should allow an approved vault address to set reporting approval");
    });

});
