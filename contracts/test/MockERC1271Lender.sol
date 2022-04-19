// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";

import "../interfaces/IOriginationController.sol";


contract ERC1271LenderMock is IERC1271 {
    bytes4 constant internal MAGICVALUE = 0x1626ba7e;

    function approve(address token, address target) external {
        IERC20(token).approve(target, type(uint256).max);
    }

    function isValidSignature(
        bytes32 _hash,
        bytes memory _signature
    ) public view override returns (bytes4 magicValue) {
        return MAGICVALUE;
    }
}
