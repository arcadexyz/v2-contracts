// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

import "../interfaces/IVaultInventoryReporter.sol";
import "../external/interfaces/IPunks.sol";

import "hardhat/console.sol";

// TODO: Write tests
// TODO: Add permissions

/**
 * @title VaultInventoryReporter
 * @author Non-Fungible Technologies, Inc.
 *
 * The VaultInventoryReporter contract is a global tracker of reported
 * inventory in all Arcade Asset Vaults. This reporting should _always_
 * be accurate, but will _not_ be comprehensive - that is, many vaults
 * will end up having unreported inventory. This contract should
 * be used specifically to verify _whether_ certain items are in the
 * reported inventory, and not to get a sense of truth as to _all_
 * the items in a particular vault.
 */
contract VaultInventoryReporter is IVaultInventoryReporter {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // ============================================ STATE ==============================================

    // ============= Global Immutable State ==============

    /// @dev To prevent gas consumption issues, registering more than 50 items
    ///      in a single transaction will revert.
    uint256 public constant MAX_ITEMS_PER_REGISTRATION = 50;

    // ============= Inventory State ==============

    /// @notice vault address -> itemHash -> Item metadata
    mapping(address => mapping(bytes32 => Item)) public inventoryForVault;
    /// @notice vault address -> itemHash[] (for enumeration)
    mapping(address => EnumerableSet.Bytes32Set) private inventoryKeysForVault;

    // ===================================== INVENTORY OPERATIONS ======================================

    /**
     * @notice Add items to the vault's registered inventory. If specified items
     *         are not owned by the vault, add will revert.
     *
     * @param vault                         The address of the vault.
     * @param items                         The list of items to add.
     */
    // solhint-disable-next-line code-complexity
    function add(address vault, Item[] calldata items) external override {
        // For each item, verify the vault actually owns it, or revert
        uint256 numItems = items.length;

        if (numItems == 0) revert VIR_NoItems();
        if (numItems > MAX_ITEMS_PER_REGISTRATION) revert VIR_TooManyItems(MAX_ITEMS_PER_REGISTRATION);

        for (uint256 i = 0; i < numItems; i++) {
            Item calldata item = items[i];

            if (item.tokenAddress == address(0)) revert VIR_InvalidRegistration(vault, i);

            bytes32 itemHash = _hash(item);

            if (item.itemType == ItemType.ERC_721) {
                if (IERC721(item.tokenAddress).ownerOf(item.tokenId) != vault) {
                    revert VIR_NotVerified(vault, i);
                }
            } else if (item.itemType == ItemType.ERC_1155) {
                if (IERC1155(item.tokenAddress).balanceOf(vault, item.tokenId) < item.tokenAmount) {
                    revert VIR_NotVerified(vault, i);
                }
            } else if (item.itemType == ItemType.ERC_20) {
                if (IERC20(item.tokenAddress).balanceOf(vault) < item.tokenAmount) {
                    revert VIR_NotVerified(vault, i);
                }
            } else if (item.itemType == ItemType.PUNKS) {
                if (IPunks(item.tokenAddress).punkIndexToAddress(item.tokenId) != vault) {
                    revert VIR_NotVerified(vault, i);
                }
            }

            // If all checks pass, add item to inventory, replacing anything with the same item hash
            // Does not encode itemType, meaning updates can be made if wrong item type was submitted
            inventoryForVault[vault][itemHash] = item;
            inventoryKeysForVault[vault].add(itemHash);

            emit Add(vault, msg.sender, itemHash);
        }
    }

    /**
     * @notice Remove items from the vault's registered inventory. If specified items
     *         are not registered as inventory, the function will not revert.
     *
     * @param vault                         The address of the vault.
     * @param items                         The list of items to remove.
     */
    function remove(address vault, Item[] calldata items) external override {
        uint256 numItems = items.length;

        if (numItems > MAX_ITEMS_PER_REGISTRATION) revert VIR_TooManyItems(MAX_ITEMS_PER_REGISTRATION);

        for (uint256 i = 0; i < numItems; i++) {
            bytes32 itemHash = _hash(items[i]);

            delete inventoryForVault[vault][itemHash];
            inventoryKeysForVault[vault].remove(itemHash);

            emit Remove(vault, msg.sender, itemHash);
        }
    }

    /**
     * @notice Remove all items from the vault's registered inventory.
     *
     * @param vault                         The address of the vault.
     */
    function clear(address vault) external override {
        uint256 numItems = inventoryKeysForVault[vault].length();

        if (numItems > MAX_ITEMS_PER_REGISTRATION) revert VIR_TooManyItems(MAX_ITEMS_PER_REGISTRATION);

        for (uint256 i = 0; i < numItems; i++) {
            bytes32 itemHash = inventoryKeysForVault[vault].at(i);

            delete inventoryForVault[vault][itemHash];
            inventoryKeysForVault[vault].remove(itemHash);
        }

        emit Clear(vault, msg.sender);
    }

    // ========================================= VERIFICATION ==========================================

    /**
     * @notice Check each item in a vault's inventory against on-chain state,
     *         returning true if all items in inventory are still held by the vault,
     *         and false if otherwise.
     *
     * @param vault                         The address of the vault.
     *
     * @return verified                     Whether the vault inventory is still accurate.
     */
    function verify(address vault) external view override returns (bool) {
        uint256 numItems = inventoryKeysForVault[vault].length();

        for (uint256 i = 0; i < numItems; i++) {
            bytes32 itemHash = inventoryKeysForVault[vault].at(i);

            if (!_verifyItem(vault, inventoryForVault[vault][itemHash])) return false;
        }

        return true;
    }

    /**
     * @notice Check a specific item in the vault's inventory against on-chain state,
     *         returning true if all items in inventory are still held by the vault,
     *         and false if otherwise. Reverts if item not in inventory.
     *
     * @param vault                         The address of the vault.
     * @param item                          The item to verify.
     *
     * @return verified                     Whether the vault inventory is still accurate.
     */
    function verifyItem(address vault, Item memory item) external view override returns (bool) {
        bytes32 itemHash = _hash(item);

        if (!inventoryKeysForVault[vault].contains(itemHash)) {
            revert VIR_NotInInventory(vault, itemHash);
        }

        return _verifyItem(vault, item);
    }

    // ========================================= ENUMERATION ===========================================

    /**
     * @notice Return a list of items in the vault. Does not check for staleness.
     *
     * @param vault                         The address of the vault.
     *
     * @return items                        An array of items in the vault.
     */
    function enumerate(address vault) external view override returns (Item[] memory items) {
        uint256 numItems = inventoryKeysForVault[vault].length();
        items = new Item[](numItems);

        for (uint256 i = 0; i < numItems; i++) {
            bytes32 itemHash = inventoryKeysForVault[vault].at(i);

            items[i] = inventoryForVault[vault][itemHash];
        }
    }

    /**
     * @notice Return a list of items in the vault. Checks for staleness and reverts if
     *         a reported asset is no longer owned.
     *
     * @param vault                         The address of the vault.
     *
     * @return items                        An array of items in the vault.
     */
    function enumerateOrFail(address vault) external view override returns (Item[] memory items) {
        uint256 numItems = inventoryKeysForVault[vault].length();
        items = new Item[](numItems);

        for (uint256 i = 0; i < numItems; i++) {
            bytes32 itemHash = inventoryKeysForVault[vault].at(i);

            if (!_verifyItem(vault, inventoryForVault[vault][itemHash])) {
                revert VIR_NotVerified(vault, i);
            }

            items[i] = inventoryForVault[vault][itemHash];

        }
    }

    /**
     * @notice Return a list of lookup keys for items in the vault, which is each item's
     *         itemHash value. Does not check for staleness.
     *
     * @param vault                         The address of the vault.
     *
     * @return keys                         An array of lookup keys for all vault items.
     */
    function keys(address vault) external view override returns (bytes32[] memory) {
        return inventoryKeysForVault[vault].values();
    }

    /**
     * @notice Return the lookup key at the specified index. Does not check for staleness.
     *
     * @param vault                         The address of the vault.
     * @param index                         The index of the key to look up.
     *
     * @return key                          The key at the specified index.
     */
    function keyAtIndex(address vault, uint256 index) external view override returns (bytes32) {
        return inventoryKeysForVault[vault].at(index);
    }

    /**
     * @notice Return the item stored by the lookup key at the specified index.
     *         Does not check for staleness.
     *
     * @param vault                         The address of the vault.
     * @param index                         The index of the key to look up.
     *
     * @return item                         The item at the specified index.
     */
    function itemAtIndex(address vault, uint256 index) external view override returns (Item memory) {
        bytes32 itemHash = inventoryKeysForVault[vault].at(index);
        return inventoryForVault[vault][itemHash];
    }

    // =========================================== HELPERS =============================================


    /**
     * @dev Read the Item struct and check owner/balance function according
     *      to item type.
     *
     * @param vault                         The address of the vault.
     * @param item                          The item to verify.
     *
     * @return verified                     Whether the vault inventory is still accurate.
     */
    // solhint-disable-next-line code-complexity
    function _verifyItem(address vault, Item memory item) internal view returns (bool) {
        if (item.itemType == ItemType.ERC_721) {
            if (IERC721(item.tokenAddress).ownerOf(item.tokenId) != vault) {
                return false;
            }
        } else if (item.itemType == ItemType.ERC_1155) {
            if (IERC1155(item.tokenAddress).balanceOf(vault, item.tokenId) < item.tokenAmount) {
                return false;
            }
        } else if (item.itemType == ItemType.ERC_20) {
            if (IERC20(item.tokenAddress).balanceOf(vault) < item.tokenAmount) {
                return false;
            }
        } else if (item.itemType == ItemType.PUNKS) {
            if (IPunks(item.tokenAddress).punkIndexToAddress(item.tokenId) != vault) {
                return false;
            }
        }

        return true;
    }

    /**
     * @dev Hash the fields of the Item struct.
     *
     * @param item                          The item to hash.
     *
     * @return hash                         The digest of the hash.
     */
    function _hash(Item memory item) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(item.tokenAddress, item.tokenId, item.tokenAmount));
    }
}
