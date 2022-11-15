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
import { mintToAddress as mintERC721, ZERO_ADDRESS } from "./utils/erc721";
import { mintToAddress as mintERC1155 } from "./utils/erc1155";
import { deploy } from "./utils/contracts";
import { createInventoryPermitSignature, InventoryPermitData } from "./utils/eip712";
import { report } from "process";

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
    let defaultItems: Item[];
    let ctx: TestContext;
    let amount20: BigNumberish;
    let id721: BigNumberish;
    let id1155: BigNumberish;
    let amount1155: BigNumberish;
    let idPunk: BigNumberish;

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

        defaultItems = [
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
    });

    describe("Inventory Operations", () => {
        describe("add", () => {

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
                const { reporter, user, vault } = ctx;

                const items = defaultItems;

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
                const { reporter, user, other, vault } = ctx;

                await reporter.connect(user).setApproval(vault.address, other.address);

                const items = defaultItems;

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

                expect((await reporter.keys(vault.address)).length).to.eq(4);
            });

            it("should not allow an address to add items to inventory with an invalid permit signature", async () => {
                const { reporter, user, other, vault } = ctx;

                const deadline = maxDeadline;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 1000, // use invalid nonce
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                const items = defaultItems;

                await expect(
                    reporter.connect(other).addWithPermit(vault.address, items, deadline, sig.v, sig.r, sig.s)
                ).to.be.revertedWith("VIR_InvalidPermitSignature");
            });

            it("should not allow an address to add items to inventory with an expired permit signature", async () => {
                const { reporter, user, other, vault } = ctx;

                // Make deadline in the past
                const lastBlock = await hre.ethers.provider.getBlock("latest");
                const deadline = lastBlock.timestamp - 1000;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 0,
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                const items = defaultItems;

                await expect(
                    reporter.connect(other).addWithPermit(vault.address, items, deadline, sig.v, sig.r, sig.s)
                ).to.be.revertedWith("VIR_PermitDeadlineExpired");
            });

            it("should allow an address to add items to inventory with a permit signature from the owner", async () => {
                const { reporter, user, other, vault } = ctx;

                const deadline = maxDeadline;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 0,
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                const items = defaultItems;

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
            beforeEach(async () => {
                // before - mint some NFTs and register some inventory
                const { reporter, user, vault } = ctx;

                await reporter.connect(user).add(vault.address, defaultItems);
            });

            it("should revert if attempting to remove zero items", async () => {
                const { reporter, user, vault } = ctx;

                await expect(
                    reporter.connect(user).remove(vault.address, [])
                ).to.be.revertedWith("VIR_NoItems");
            });

            it("should revert if attempting to remove more items than the maximum", async () => {
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
                    reporter.connect(user).remove(vault.address, items)
                ).to.be.revertedWith("VIR_TooManyItems");
            });

            it("should revert if the caller is not the vault's owner or approved", async () => {
                const { reporter, other, vault } = ctx;
                const items = defaultItems;

                await expect(
                    reporter.connect(other).remove(vault.address, items)
                ).to.be.revertedWith("VIR_NotApproved");
            });

            it("should allow the vault owner to remove items from inventory", async () => {
                const { reporter, user, vault } = ctx;

                await expect(
                    reporter.connect(user).remove(vault.address, defaultItems)
                ).to.emit(reporter, "Remove")
                    .withArgs(vault.address, user.address, hashItem(defaultItems[0]))
                    .to.emit(reporter, "Remove")
                    .withArgs(vault.address, user.address, hashItem(defaultItems[1]))
                    .to.emit(reporter, "Remove")
                    .withArgs(vault.address, user.address, hashItem(defaultItems[2]))
                    .to.emit(reporter, "Remove")
                    .withArgs(vault.address, user.address, hashItem(defaultItems[3]));
            });

            it("should allow an approved address to remove items from inventory", async () => {
                const { reporter, user, other, vault } = ctx;

                await reporter.connect(user).setApproval(vault.address, other.address);

                await expect(
                    reporter.connect(other).remove(vault.address, defaultItems)
                ).to.emit(reporter, "Remove")
                    .withArgs(vault.address, other.address, hashItem(defaultItems[0]))
                    .to.emit(reporter, "Remove")
                    .withArgs(vault.address, other.address, hashItem(defaultItems[1]))
                    .to.emit(reporter, "Remove")
                    .withArgs(vault.address, other.address, hashItem(defaultItems[2]))
                    .to.emit(reporter, "Remove")
                    .withArgs(vault.address, other.address, hashItem(defaultItems[3]));

                expect((await reporter.keys(vault.address)).length).to.eq(0);
            });

            it("should not revert if a specified item is not registered in inventory", async () => {
                const { reporter, user, vault, mockERC721 } = ctx;

                // Add an item not previously registered
                const items = [
                    ...defaultItems,
                    {
                        itemType: ERC_721_ITEM_TYPE,
                        tokenAddress: mockERC721.address,
                        tokenId: BigNumber.from(id721).mul(2), // Different ID
                        tokenAmount: 0
                    }
                ]


                const tx = await reporter.connect(user).remove(vault.address, items);
                const receipt = await tx.wait();

                // Make sure only 4 events, although there are 5 items
                expect(receipt?.events?.length).to.eq(items.length - 1);
            });

            it("should not allow an address to remove items from inventory with an invalid permit signature", async () => {
                const { reporter, user, other, vault } = ctx;

                const deadline = maxDeadline;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 1000, // use invalid nonce
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                await expect(
                    reporter.connect(other).removeWithPermit(vault.address, defaultItems, deadline, sig.v, sig.r, sig.s)
                ).to.be.revertedWith("VIR_InvalidPermitSignature");
            });

            it("should not allow an address to remove items from inventory with an expired permit signature", async () => {
                const { reporter, user, other, vault } = ctx;

                // Make deadline in the past
                const lastBlock = await hre.ethers.provider.getBlock("latest");
                const deadline = lastBlock.timestamp - 1000;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 0,
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                const items = defaultItems;

                await expect(
                    reporter.connect(other).removeWithPermit(vault.address, items, deadline, sig.v, sig.r, sig.s)
                ).to.be.revertedWith("VIR_PermitDeadlineExpired");
            });

            it("should allow an address to remove items from inventory with a permit signature from the owner", async () => {
                const { reporter, user, other, vault } = ctx;

                const deadline = maxDeadline;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 0,
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                const items = defaultItems;

                await expect(
                    reporter.connect(other).removeWithPermit(vault.address, items, deadline, sig.v, sig.r, sig.s)
                ).to.emit(reporter, "Remove")
                    .withArgs(vault.address, other.address, hashItem(items[0]))
                    .to.emit(reporter, "Remove")
                    .withArgs(vault.address, other.address, hashItem(items[1]))
                    .to.emit(reporter, "Remove")
                    .withArgs(vault.address, other.address, hashItem(items[2]))
                    .to.emit(reporter, "Remove")
                    .withArgs(vault.address, other.address, hashItem(items[3]));
            });
        });

        describe("clear", () => {
            // before - mint some NFTs and register some inventory
            beforeEach(async () => {
                // before - mint some NFTs and register some inventory
                const { reporter, user, vault } = ctx;

                await reporter.connect(user).add(vault.address, defaultItems);
            });

            it("should revert if the vault's registered inventory is larger than the maximum items per update", async () => {
                const { reporter, user, mockERC721, vault } = ctx;
                const numToAdd = (await reporter.MAX_ITEMS_PER_REGISTRATION()).sub(1).toNumber();

                const items: Item[] = [];

                // Mint 49 more NFTs and add to inventory
                for (let i = 0; i < numToAdd - 1; i++) {
                    items.push({
                        itemType: ERC_721_ITEM_TYPE,
                        tokenAddress: mockERC721.address,
                        tokenId: await mintERC721(mockERC721, vault.address),
                        tokenAmount: 0
                    });
                }

                await reporter.connect(user).add(vault.address, items);

                // Try to clear
                await expect(
                    reporter.connect(user).clear(vault.address)
                ).to.be.revertedWith("VIR_TooManyItems");
            });

            it("should revert if the caller is not the vault's owner or approved", async () => {
                const { reporter, other, vault } = ctx;

                await expect(
                    reporter.connect(other).clear(vault.address)
                ).to.be.revertedWith("VIR_NotApproved");
            });

            it("should allow the vault owner to clear inventory", async () => {
                const { reporter, user, vault } = ctx;

                await expect(
                    reporter.connect(user).clear(vault.address)
                ).to.emit(reporter, "Clear")
                    .withArgs(vault.address, user.address);

                expect((await reporter.keys(vault.address)).length).to.eq(0);
            });

            it("should allow an approved address to clear inventory", async () => {
                const { reporter, user, other, vault } = ctx;

                await reporter.connect(user).setApproval(vault.address, other.address);

                await expect(
                    reporter.connect(other).clear(vault.address)
                ).to.emit(reporter, "Clear")
                    .withArgs(vault.address, other.address);
            });

            it("should not allow an address to clear inventory with an invalid permit signature", async () => {
                const { reporter, user, other, vault } = ctx;

                const deadline = maxDeadline;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 1000, // use invalid nonce
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                await expect(
                    reporter.connect(other).clearWithPermit(vault.address, deadline, sig.v, sig.r, sig.s)
                ).to.be.revertedWith("VIR_InvalidPermitSignature");
            });

            it("should not allow an address to clear inventory with an expired permit signature", async () => {
                const { reporter, user, other, vault } = ctx;

                // Make deadline in the past
                const lastBlock = await hre.ethers.provider.getBlock("latest");
                const deadline = lastBlock.timestamp - 1000;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 0,
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                await expect(
                    reporter.connect(other).clearWithPermit(vault.address, deadline, sig.v, sig.r, sig.s)
                ).to.be.revertedWith("VIR_PermitDeadlineExpired");
            });

            it("should allow an address to clear inventory with a permit signature from the owner", async () => {
                const { reporter, user, other, vault } = ctx;

                const deadline = maxDeadline;

                const permitData: InventoryPermitData = {
                    owner: user.address,
                    target: other.address,
                    vault: vault.address,
                    nonce: 0,
                    deadline
                };

                const sig = await createInventoryPermitSignature(
                    reporter.address,
                    NAME,
                    permitData,
                    user
                );

                await expect(
                    reporter.connect(other).clearWithPermit(vault.address, deadline, sig.v, sig.r, sig.s)
                ).to.emit(reporter, "Clear")
                    .withArgs(vault.address, other.address);
            });
        });
    });

    describe("Verification", () => {
        beforeEach(async () => {
            // before - mint some NFTs and register some inventory
            const { reporter, user, vault } = ctx;

            await reporter.connect(user).add(vault.address, defaultItems);
        });

        it("should verify all items in a vault's inventory are currently held", async () => {
            const { reporter, vault } = ctx;

            // Make sure verification succeeds
            expect(await reporter.verify(vault.address)).to.be.true;
        });

        it("should return false if all items in a vault's inventory are not owned by the vault", async () => {
            const { reporter, user, mockERC721, vault } = ctx;

            // Make sure verification succeeds
            expect(await reporter.verify(vault.address)).to.be.true;

            // Move item out of vault
            await vault.connect(user).enableWithdraw();
            await vault.connect(user).withdrawERC721(mockERC721.address, id721, user.address);

            // make sure verification fails
            expect(await reporter.verify(vault.address)).to.be.false;
        });

        it("should verify whether a specific item in a vault's inventory is currently held", async () => {
            const { reporter, vault } = ctx;

            // Make sure verification succeeds
            expect(await reporter.verifyItem(vault.address, defaultItems[0])).to.be.true;
        });

        it("should revert if a specific item submitted for verification is not in the registered inventory", async () => {
            const { reporter, vault } = ctx;

            const item: Item = {
                ...defaultItems[1],
                tokenId: BigNumber.from(id721).mul(2)
            };

            await expect(
                reporter.verifyItem(vault.address, item)
            ).to.be.revertedWith("VIR_NotInInventory")
        });

        it("should return false if a specific item in a vault's inventory is not owned by the vault", async () => {
            const { reporter, user, mockERC721, vault } = ctx;

            // Make sure verification succeeds
            expect(await reporter.verifyItem(vault.address, defaultItems[1])).to.be.true;

            // Move item out of vault
            await vault.connect(user).enableWithdraw();
            await vault.connect(user).withdrawERC721(mockERC721.address, id721, user.address);

            // make sure verification fails
            expect(await reporter.verifyItem(vault.address, defaultItems[1])).to.be.false;
        });
    });

    describe("Enumeration", () => {
        beforeEach(async () => {
            // before - mint some NFTs and register some inventory
            const { reporter, user, vault } = ctx;

            await reporter.connect(user).add(vault.address, defaultItems);
        });

        it("should enumerate all items in a vault, without checking staleness", async () => {
            const { reporter, vault, user, mockERC721 } = ctx;

            let items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(defaultItems.length);

            for (let i = 0; i < items.length; i++) {
                expect(items[i].itemType).to.eq(defaultItems[i].itemType);
                expect(items[i].tokenAddress).to.eq(defaultItems[i].tokenAddress);
                expect(items[i].tokenId).to.eq(defaultItems[i].tokenId);
                expect(items[i].tokenAmount).to.eq(defaultItems[i].tokenAmount);
            }

            // Move item out of vault
            await vault.connect(user).enableWithdraw();
            await vault.connect(user).withdrawERC721(mockERC721.address, id721, user.address);

            // Enumerate again, get same results
            items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(defaultItems.length);

            for (let i = 0; i < items.length; i++) {
                expect(items[i].itemType).to.eq(defaultItems[i].itemType);
                expect(items[i].tokenAddress).to.eq(defaultItems[i].tokenAddress);
                expect(items[i].tokenId).to.eq(defaultItems[i].tokenId);
                expect(items[i].tokenAmount).to.eq(defaultItems[i].tokenAmount);
            }
        });

        it("should revert on enumerateOrFail if inventory is stale", async () => {
            const { reporter, vault, user, mockERC721 } = ctx;

            const items = await reporter.enumerateOrFail(vault.address);

            expect(items.length).to.eq(defaultItems.length);

            for (let i = 0; i < items.length; i++) {
                expect(items[i].itemType).to.eq(defaultItems[i].itemType);
                expect(items[i].tokenAddress).to.eq(defaultItems[i].tokenAddress);
                expect(items[i].tokenId).to.eq(defaultItems[i].tokenId);
                expect(items[i].tokenAmount).to.eq(defaultItems[i].tokenAmount);
            }

            // Move item out of vault
            await vault.connect(user).enableWithdraw();
            await vault.connect(user).withdrawERC721(mockERC721.address, id721, user.address);

            // Enumerate again, get same results
            await expect(
                reporter.enumerateOrFail(vault.address)
            ).to.be.revertedWith("VIR_NotVerified");
        });

        it("should report all item hashes for a vault's inventory", async () => {
            const { reporter, vault } = ctx;

            const keys = await reporter.keys(vault.address);

            expect(keys.length).to.eq(defaultItems.length);

            for (let i = 0; i < keys.length; i++) {
                expect(keys[i]).to.eq(hashItem(defaultItems[i]));
            }
        });

        it("should report a specific item hash for a vault's inventory", async () => {
            const { reporter, vault } = ctx;

            const keys = await reporter.keys(vault.address);

            for (let i = 0; i < keys.length; i++) {
                const key = await reporter.keyAtIndex(vault.address, i);
                expect(key).to.eq(hashItem(defaultItems[i]));
            }
        });

        it("should report a specific item for a vault's inventory", async () => {
            const { reporter, vault, user, mockERC721 } = ctx;

            const keys = await reporter.keys(vault.address);

            for (let i = 0; i < keys.length; i++) {
                const item = await reporter.itemAtIndex(vault.address, i);

                expect(item.itemType).to.eq(defaultItems[i].itemType);
                expect(item.tokenAddress).to.eq(defaultItems[i].tokenAddress);
                expect(item.tokenId).to.eq(defaultItems[i].tokenId);
                expect(item.tokenAmount).to.eq(defaultItems[i].tokenAmount);
            }

            // Move item out of vault
            await vault.connect(user).enableWithdraw();
            await vault.connect(user).withdrawERC721(mockERC721.address, id721, user.address);

            // Enumerate again, get same results
            await expect(
                reporter.enumerateOrFail(vault.address)
            ).to.be.revertedWith("VIR_NotVerified");
        });
    });

    describe("Permissions", () => {
        it("should not allow a user who is not owner or approved for a vault to set reporting approval", async () => {
            const { reporter, other, vault } = ctx;

            await expect(
                reporter.connect(other).setApproval(vault.address, other.address)
            ).to.be.revertedWith("VOC_NotOwnerOrApproved");
        });

        it("should allow a vault owner to set reporting approval", async () => {
            const { reporter, user, other, vault } = ctx;

            expect(await reporter.isOwnerOrApproved(vault.address, other.address)).to.be.false;

            await expect(
                reporter.connect(user).setApproval(vault.address, other.address)
            ).to.emit(reporter, "SetApproval")
                .withArgs(vault.address, other.address);

            expect(await reporter.isOwnerOrApproved(vault.address, other.address)).to.be.true;
        });

        it("should allow a vault owner to remove all reporting approval", async () => {
            const { reporter, user, other, vault } = ctx;

            expect(await reporter.isOwnerOrApproved(vault.address, other.address)).to.be.false;

            await expect(
                reporter.connect(user).setApproval(vault.address, other.address)
            ).to.emit(reporter, "SetApproval")
                .withArgs(vault.address, other.address);

            expect(await reporter.isOwnerOrApproved(vault.address, other.address)).to.be.true;

            await expect(
                reporter.connect(user).setApproval(vault.address, ZERO_ADDRESS)
            ).to.emit(reporter, "SetApproval")
                .withArgs(vault.address, ZERO_ADDRESS);

            expect(await reporter.isOwnerOrApproved(vault.address, other.address)).to.be.false;
        });

        it("should allow an approved vault address to set reporting approval", async () => {
            const { reporter, user, other, vault, nft } = ctx;

            await nft.connect(user).approve(other.address, vault.address);

            expect(await reporter.isOwnerOrApproved(vault.address, other.address)).to.be.false;

            await expect(
                reporter.connect(other).setApproval(vault.address, other.address)
            ).to.emit(reporter, "SetApproval")
                .withArgs(vault.address, other.address);

            expect(await reporter.isOwnerOrApproved(vault.address, other.address)).to.be.true;
        });
    });

});
