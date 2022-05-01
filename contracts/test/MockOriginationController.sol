// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

import "../OriginationController.sol";

contract MockOriginationController is OriginationController {
    function version() pure public returns (string memory) {
        return "This is OriginationController V2!";
    }
}