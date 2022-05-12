// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "../RepaymentController.sol";

contract RepaymentContV2 is RepaymentController {
    function version() public pure returns (string memory) {
        return "This is RepaymentController V2!";
    }
}
