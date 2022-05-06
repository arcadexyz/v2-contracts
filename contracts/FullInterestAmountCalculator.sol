// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./interfaces/IFullInterestAmountCalculator.sol";

/**
 * @dev Interface for a calculating the interest amount given a interest rate and principal amount
 *
 */
abstract contract FullInterestAmountCalculator is IFullInterestAmountCalculator {
    uint256 private totalInterestAmount = 0;

    /**
     * @inheritdoc IFullInterestAmountCalculator
     */
    function getFullInterestAmount(uint256 principal, uint256 interestRate) public view virtual returns (uint256) {
        return totalInterestAmount;
    }
}
