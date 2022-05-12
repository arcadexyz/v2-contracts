// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { OERC721_CallerNotOwner } from "../errors/Vault.sol";

/* @title OwnableERC721
 * @notice Use ERC721 ownership for access control
 *  Requires tokenId scheme must map to map uint256(contract address)
 */
abstract contract OwnableERC721 {
    address public ownershipToken;

    modifier onlyOwner() {
        if (owner() != msg.sender) revert OERC721_CallerNotOwner(msg.sender);
        _;
    }

    function _setNFT(address _ownershipToken) internal {
        ownershipToken = _ownershipToken;
    }

    function owner() public view virtual returns (address ownerAddress) {
        return IERC721(ownershipToken).ownerOf(uint256(uint160(address(this))));
    }
}
