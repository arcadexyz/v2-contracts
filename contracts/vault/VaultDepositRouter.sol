// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IVaultDepositRouter.sol";
import "../interfaces/IVaultInventoryReporter.sol";
import "../interfaces/IVaultFactory.sol";
import "../external/interfaces/IPunks.sol";

/**
 * @title VaultInventoryReporter
 * @author Non-Fungible Technologies, Inc.
 *
 * The VaultInventoryReporter contract is a helper contract that
 * works with Arcade asset vaults and the vault inventory reporter.
 * By depositing to asset vaults by calling the functions in this contract,
 * inventory registration will be automatically updated.
 */
contract VaultDepositRouter is IVaultDepositRouter {
    using SafeERC20 for IERC20;

    // ============================================ STATE ==============================================

    // ============= Global Immutable State ==============

    address public immutable factory;
    IVaultInventoryReporter public immutable reporter;

    // ========================================= CONSTRUCTOR ===========================================

    constructor(address _factory, address _reporter) {
        if (_factory == address(0)) revert VDR_ZeroAddress();
        if (_reporter == address(0)) revert VDR_ZeroAddress();

        factory = _factory;
        reporter = IVaultInventoryReporter(_reporter);
    }

    // ====================================== DEPOSIT OPERATIONS ========================================

    function depositERC20(
        address vault,
        address token,
        uint256 amount
    ) external override validate(vault, msg.sender) {
        IERC20(token).safeTransferFrom(msg.sender, vault, amount);

        IVaultInventoryReporter.Item[] memory items = new IVaultInventoryReporter.Item[](1);

        items[0] = IVaultInventoryReporter.Item({
            itemType: IVaultInventoryReporter.ItemType.ERC_20,
            tokenAddress: token,
            tokenId: 0,
            tokenAmount: amount
        });

        reporter.add(vault, items);

        // No events because both token and reporter will emit
    }

    function depositERC20Batch(
        address vault,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external override validate(vault, msg.sender) {
        uint256 numItems = tokens.length;
        if (numItems != amounts.length) revert VDR_BatchLengthMismatch();

        IVaultInventoryReporter.Item[] memory items = new IVaultInventoryReporter.Item[](numItems);

        for (uint256 i = 0; i < numItems; i++) {
            address token = tokens[i];
            uint256 amount = amounts[i];

            IERC20(token).safeTransferFrom(msg.sender, vault, amount);

            items[i] = IVaultInventoryReporter.Item({
                itemType: IVaultInventoryReporter.ItemType.ERC_20,
                tokenAddress: token,
                tokenId: 0,
                tokenAmount: amount
            });
        }

        reporter.add(vault, items);

        // No events because both token and reporter will emit
    }

    function depositERC721(
        address vault,
        address token,
        uint256 id
    ) external override validate(vault, msg.sender) {
        IERC721(token).safeTransferFrom(msg.sender, vault, id);

        IVaultInventoryReporter.Item[] memory items = new IVaultInventoryReporter.Item[](1);

        items[0] = IVaultInventoryReporter.Item({
            itemType: IVaultInventoryReporter.ItemType.ERC_721,
            tokenAddress: token,
            tokenId: id,
            tokenAmount: 0
        });

        reporter.add(vault, items);

        // No events because both token and reporter will emit
    }

    function depositERC721Batch(
        address vault,
        address[] calldata tokens,
        uint256[] calldata ids
    ) external override validate(vault, msg.sender) {
        uint256 numItems = tokens.length;
        if (numItems != ids.length) revert VDR_BatchLengthMismatch();

        IVaultInventoryReporter.Item[] memory items = new IVaultInventoryReporter.Item[](numItems);

        for (uint256 i = 0; i < numItems; i++) {
            address token = tokens[i];
            uint256 id = ids[i];

            IERC721(token).safeTransferFrom(msg.sender, vault, id);

            items[i] = IVaultInventoryReporter.Item({
                itemType: IVaultInventoryReporter.ItemType.ERC_721,
                tokenAddress: token,
                tokenId: 0,
                tokenAmount: id
            });
        }

        reporter.add(vault, items);

        // No events because both token and reporter will emit
    }

    function depositERC1155(
        address vault,
        address token,
        uint256 id,
        uint256 amount
    ) external override validate(vault, msg.sender) {
        IERC1155(token).safeTransferFrom(msg.sender, vault, id, amount, "");

        IVaultInventoryReporter.Item[] memory items = new IVaultInventoryReporter.Item[](1);

        items[0] = IVaultInventoryReporter.Item({
            itemType: IVaultInventoryReporter.ItemType.ERC_1155,
            tokenAddress: token,
            tokenId: id,
            tokenAmount: amount
        });

        reporter.add(vault, items);

        // No events because both token and reporter will emit
    }

    function depositERC1155Batch(
        address vault,
        address[] calldata tokens,
        uint256[] calldata ids,
        uint256[] calldata amounts
    ) external override validate(vault, msg.sender) {
        uint256 numItems = tokens.length;
        if (numItems != ids.length) revert VDR_BatchLengthMismatch();

        IVaultInventoryReporter.Item[] memory items = new IVaultInventoryReporter.Item[](numItems);

        for (uint256 i = 0; i < numItems; i++) {
            address token = tokens[i];
            uint256 id = ids[i];
            uint256 amount = amounts[i];

            IERC1155(token).safeTransferFrom(msg.sender, vault, id, amount, "");

            items[i] = IVaultInventoryReporter.Item({
                itemType: IVaultInventoryReporter.ItemType.ERC_1155,
                tokenAddress: token,
                tokenId: id,
                tokenAmount: amount
            });
        }

        reporter.add(vault, items);

        // No events because both token and reporter will emit
    }

    function depositPunk(
        address vault,
        address token,
        uint256 id
    ) external override validate(vault, msg.sender) {
        IPunks(token).buyPunk(id);
        IPunks(token).transferPunk(vault, id);

        IVaultInventoryReporter.Item[] memory items = new IVaultInventoryReporter.Item[](1);

        items[0] = IVaultInventoryReporter.Item({
            itemType: IVaultInventoryReporter.ItemType.PUNKS,
            tokenAddress: token,
            tokenId: id,
            tokenAmount: 0
        });

        reporter.add(vault, items);

        // No events because both token and reporter will emit
    }

    function depositPunkBatch(
        address vault,
        address[] calldata tokens,
        uint256[] calldata ids
    ) external override validate(vault, msg.sender) {
        uint256 numItems = tokens.length;
        if (numItems != ids.length) revert VDR_BatchLengthMismatch();

        IVaultInventoryReporter.Item[] memory items = new IVaultInventoryReporter.Item[](numItems);

        for (uint256 i = 0; i < numItems; i++) {
            address token = tokens[i];
            uint256 id = ids[i];

            IPunks(token).buyPunk(id);
            IPunks(token).transferPunk(vault, id);

            items[i] = IVaultInventoryReporter.Item({
                itemType: IVaultInventoryReporter.ItemType.PUNKS,
                tokenAddress: token,
                tokenId: 0,
                tokenAmount: id
            });
        }

        reporter.add(vault, items);

        // No events because both token and reporter will emit
    }

    // ============================================ HELPERS =============================================

    modifier validate(address vault, address caller) {
        if (vault == address(0)) revert VDR_ZeroAddress();
        if (!IVaultFactory(factory).isInstance(vault)) revert VDR_InvalidVault(vault);

        uint256 tokenId = uint256(uint160(vault));
        address owner = IERC721(factory).ownerOf(tokenId);

        if (
            caller != owner
            && IERC721(factory).getApproved(tokenId) != caller
            && !IERC721(factory).isApprovedForAll(owner, caller)
        ) revert VDR_NotOwnerOrApproved(vault, caller);

        _;
    }


}