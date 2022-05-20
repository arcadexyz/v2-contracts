// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "../OriginationController.sol";

contract MockOriginationController is OriginationController {
    function version() public pure returns (string memory) {
        return "This is OriginationController V2!";
    }

    function isApproved(address owner, address signer) public pure override returns (bool) {
        return owner != signer;
    }
}
