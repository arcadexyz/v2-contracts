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

abstract contract VaultOwnershipChecker {

    // ============= Errors ==============

    error VOC_ZeroAddress();
    error VOC_InvalidVault(address vault);
    error VOC_NotOwnerOrApproved(address vault, address caller);

    // ================ Ownership Check ================

    /**
     * @dev Validates that the caller is allowed to deposit to the specified vault (owner or approved),
     *      and that the specified vault exists. Reverts on failed validation.
     *
     * @param factory                       The vault ownership token for the specifide vault.
     * @param vault                         The vault that will be deposited to.
     * @param caller                        The caller who wishes to deposit.
     */
    function checkOwnership(address factory, address vault, address caller) public view returns (bool) {
        if (vault == address(0)) revert VOC_ZeroAddress();
        if (!IVaultFactory(factory).isInstance(vault)) revert VOC_InvalidVault(vault);

        uint256 tokenId = uint256(uint160(vault));
        address owner = IERC721(factory).ownerOf(tokenId);

        if (
            caller != owner
            && IERC721(factory).getApproved(tokenId) != caller
            && !IERC721(factory).isApprovedForAll(owner, caller)
        ) revert VOC_NotOwnerOrApproved(vault, caller);
    }
}