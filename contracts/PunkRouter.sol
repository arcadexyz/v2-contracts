// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./external/interfaces/IWrappedPunks.sol";
import "./external/interfaces/IPunks.sol";

import { PR_NotOwner } from "./errors/LendingUtils.sol";

/**
 * @title PunkRouter
 * @author Non-Fungible Technologies, Inc.
 *
 * Convenience contract that allows users with CryptoPunks to
 * automatically wrap and deposit their punk to an AssetVault.
 * Punks are wrapped using the Wrapped Cryptopunks ERC721 contract.
 */
contract PunkRouter is ERC721Holder, Ownable {
    // ============================================ STATE ==============================================

    IPunks public immutable punks;
    address public immutable proxy;
    IWrappedPunks public immutable wrappedPunks;

    // ========================================== CONSTRUCTOR ===========================================

    /**
     * @dev Initializes the contract with the correct contract references.
     *
     * @param _wrappedPunks         The wrapped punks contract.
     * @param _punks                The CryptoPUnks contract.
     */
    constructor(
        IWrappedPunks _wrappedPunks,
        IPunks _punks
    ) {
        punks = _punks;
        wrappedPunks = _wrappedPunks;

        wrappedPunks.registerProxy();
        proxy = wrappedPunks.proxyInfo(address(this));
    }

    /**
     * @notice Wrap and deposit an original cryptopunk into an asset vault.
     *         For depositPUnk to work, msg.sender must own the punk, and the
     *         punk must be offered for sale to the punk router address for
     *         0 ETH.
     *
     * @param punkIndex             The index of the CryptoPunk to deposit (i.e. token ID).
     * @param bundleId              The id of the asset vault to deposit into.
     */
    function depositPunk(uint256 punkIndex, uint256 bundleId) external {
        IWrappedPunks _wrappedPunks = wrappedPunks;
        address punkOwner = punks.punkIndexToAddress(punkIndex);
        if (punkOwner != msg.sender) revert PR_NotOwner(msg.sender);

        punks.buyPunk(punkIndex);
        punks.transferPunk(proxy, punkIndex);

        _wrappedPunks.mint(punkIndex);
        _wrappedPunks.safeTransferFrom(address(this), address(uint160(bundleId)), punkIndex);
    }

    /**
     * @notice Withdraw a crypto punk that is accidentally held by the PunkRouter contract.
     *         Only used for emergencies and misuse of the PunkRouter, and requires trust
     *         that the contract owner will honestly send the punk to its rightful owner.
     *
     * @param punkIndex             The index of the CryptoPunk to withdraw.
     * @param to                    The address of the new owner.
     */
    function withdrawPunk(uint256 punkIndex, address to) external onlyOwner {
        punks.transferPunk(to, punkIndex);
    }
}
