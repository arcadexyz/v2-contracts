// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.11;

import "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/IERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

import "../interfaces/IAssetVault.sol";
import "../interfaces/IVaultFactory.sol";
import "../ERC721PermitUpgradeable.sol";

import { VF_InvalidTemplate, VF_TokenIdOutOfBounds, VF_NoTransferWithdrawEnabled } from "../errors/Vault.sol";

// AccessControlUpgradeable
/** @title VaultFactory
 *   Factory for creating and registering AssetVaults
 *   Note: TokenId is simply a uint representation of the vault address
 *   To enable simple lookups from vault <-> tokenId
 */
contract VaultFactory is ERC721EnumerableUpgradeable, ERC721PermitUpgradeable, IVaultFactory {
    address public template;
    address public whitelist;

    // ========================================== CONSTRUCTOR ===========================================

    /**
     * @notice Runs the initializer function in an upgradeable contract.
     *
     *  @dev Add Unsafe-allow comment to notify upgrades plugin to accept the constructor.
     */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ========================================== INITIALIZER ===========================================

    function initialize(address _template, address _whitelist) public initializer {
        __ERC721_init("Asset Wrapper V2", "AW-V2");
        __ERC721PermitUpgradeable_init("Asset Wrapper V2");
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        if (_template == address(0)) revert VF_InvalidTemplate(_template);
        template = _template;
        whitelist = _whitelist;
    }

    // ======================================= UPGRADE AUTHORIZATION ========================================

    /**
     * @notice Authorization function to define who should be allowed to upgrade the contract
     *
     * @param newImplementation    The address of the upgraded version of this contract
     */

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ==================================== VAULTFACTORY OPERATIONS =========================================

    /**
     * @inheritdoc IVaultFactory
     */
    function isInstance(address instance) external view override returns (bool validity) {
        return _exists(uint256(uint160(instance)));
    }

    /**
     * @inheritdoc IVaultFactory
     */
    function instanceCount() external view override returns (uint256 count) {
        return totalSupply();
    }

    /**
     * @inheritdoc IVaultFactory
     */
    function instanceAt(uint256 tokenId) external view override returns (address instance) {
        // check _owners[tokenId] != address(0)
        if (!_exists(tokenId)) revert VF_TokenIdOutOfBounds(tokenId);

        return address(uint160(tokenId));
        //return address(uint160(tokenByIndex(tokenId)));
    }

    /**
     * @dev Creates a new bundle token for `to`. Its token ID will be
     * automatically assigned (and available on the emitted {IERC721-Transfer} event)
     *
     * See {ERC721-_mint}.
     */
    function initializeBundle(address to) external override returns (uint256) {
        address vault = _create();

        _mint(to, uint256(uint160(vault)));

        emit VaultCreated(vault, to);
        return uint256(uint160(vault));
    }

    /**
     * @dev Creates and initializes a minimal proxy vault instance
     */
    function _create() internal returns (address vault) {
        vault = Clones.clone(template);
        IAssetVault(vault).initialize(whitelist);
        return vault;
    }

    /**
     * @dev Hook that is called before any token transfer
     * @dev note this notifies the vault contract about the ownership transfer
     *
     * Does not let tokens with withdraw enabled be transferred - ensures
     * items cannot be withdrawn in a frontrunning attack before loan origination.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal virtual override(ERC721Upgradeable, ERC721EnumerableUpgradeable) {
        IAssetVault vault = IAssetVault(address(uint160(tokenId)));
        if (vault.withdrawEnabled()) revert VF_NoTransferWithdrawEnabled(tokenId);

        super._beforeTokenTransfer(from, to, tokenId);
    }

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721PermitUpgradeable, ERC721EnumerableUpgradeable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
