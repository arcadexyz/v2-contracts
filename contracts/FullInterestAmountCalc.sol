// SPDX-License-Identifier: MIT

pragma solidity 0.8.11;

import "./interfaces/IFullInterestAmountCalc.sol";

import { FIAC_InterestRate } from "./errors/Lending.sol";

/**
 * @dev Interface for a calculating the interest amount given a interest rate and principal amount
 *
 */
abstract contract FullInterestAmountCalc is IFullInterestAmountCalc {
    uint256 public constant INTEREST_RATE_DENOMINATOR = 1e18;
    uint256 public constant BASIS_POINTS_DENOMINATOR = 10_000;

    /**
     * @inheritdoc IFullInterestAmountCalc
     */
    function getFullInterestAmount(uint256 principal, uint256 interestRate) public pure virtual returns (uint256) {
        // Interest rate to be greater than or equal to 0.01%
        if (interestRate / INTEREST_RATE_DENOMINATOR < 1) revert FIAC_InterestRate(interestRate);

        return principal + ((principal * (interestRate / INTEREST_RATE_DENOMINATOR)) / BASIS_POINTS_DENOMINATOR);
    }
}
