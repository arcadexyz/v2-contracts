// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "../LoanCore.sol";

contract LoanCoreV2Mock is LoanCore {
    function version() public pure returns (string memory) {
        return "This is LoanCore V2!";
    }
}
