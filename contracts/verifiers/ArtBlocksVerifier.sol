// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "../interfaces/IVaultFactory.sol";
import "../interfaces/IAssetVault.sol";
import "../interfaces/ISignatureVerifier.sol";
import "../libraries/LoanLibrary.sol";

import { IV_ItemMissingAddress, IV_InvalidCollateralType, IV_NonPositiveAmount1155, IV_InvalidTokenId1155, IV_NonPositiveAmount20 } from "../errors/Lending.sol";

/**
 * @title ArcadeItemsRangeVerifier
 * @author Non-Fungible Technologies, Inc.
 *
 * See ItemsVerifier for a more thorough description of the Verifier
 * pattern used in Arcade.xyz's lending protocol. This contract
 * verifies predicates that allow the signer to specify a range of
 * token IDs, as oppossed to a single one or wildcard.
 */
contract ArcadeItemsRangeVerifier is ISignatureVerifier {
    using SafeCast for int256;

    /// @dev Enum describing the collateral type of a signature item
    enum CollateralType {
        ERC_721,
        ERC_1155,
        ERC_20
    }

    /// @dev Enum describing each item that should be validated
    struct SignatureItem {
        // The address of the collateral contract
        address asset;
        // The minimum token ID of the collateral (only applicable to 721 and 1155)
        uint256 minTokenId;
        // The maximum token ID of the collateral (only applicable to 721 and 1155)
        uint256 maxTokenId;
        // The minimum amount of collateral (only applicable for 20 and 1155)
        uint256 amount;
    }

    // ==================================== COLLATERAL VERIFICATION =====================================

    /**
     * @notice Verify that the items specified by the packed SignatureItem array are held by the vault.
     * @dev    Reverts on a malformed SignatureItem, returns false on missing contents.
     *
     *         Verification for empty predicates array has been addressed in initializeLoanWithItems and
     *         rolloverLoanWithItems.
     *
     * @param predicates                    The SignatureItem[] array of items, packed in bytes.
     * @param vault                         The vault that should own the specified items.
     *
     * @return verified                     Whether the bundle contains the specified items.
     */
    // solhint-disable-next-line code-complexity
    function verifyPredicates(bytes calldata predicates, address vault) external view override returns (bool) {
        // Unpack items
        SignatureItem[] memory items = abi.decode(predicates, (SignatureItem[]));

        for (uint256 i = 0; i < items.length; i++) {
            SignatureItem memory item = items[i];

            // No asset provided
            if (item.asset == address(0)) revert IV_ItemMissingAddress();

            if (item.cType == CollateralType.ERC_721) {
                IERC721 asset = IERC721(item.asset);
                int256 id = item.tokenId;

                // Wildcard, but vault has no assets
                if (id < 0 && asset.balanceOf(vault) == 0) return false;
                // Does not own specifically specified asset
                else if (id >= 0 && asset.ownerOf(id.toUint256()) != vault) return false;
            } else if (item.cType == CollateralType.ERC_1155) {
                IERC1155 asset = IERC1155(item.asset);

                int256 id = item.tokenId;
                uint256 amt = item.amount;

                // Cannot require 0 amount
                if (amt == 0) revert IV_NonPositiveAmount1155(item.asset, amt);

                // Wildcard not allowed for 1155
                if (id < 0) revert IV_InvalidTokenId1155(item.asset, id);

                // Does not own specifically specified asset
                if (asset.balanceOf(vault, id.toUint256()) < amt) return false;
            } else if (item.cType == CollateralType.ERC_20) {
                IERC20 asset = IERC20(item.asset);

                uint256 amt = item.amount;

                // Cannot require 0 amount
                if (amt == 0) revert IV_NonPositiveAmount20(item.asset, amt);

                // Does not own specifically specified asset
                if (asset.balanceOf(vault) < amt) return false;
            } else {
                // Interface could not be parsed - fail
                revert IV_InvalidCollateralType(item.asset, uint256(item.cType));
            }
        }

        // Loop completed - all items found
        return true;
    }
}
