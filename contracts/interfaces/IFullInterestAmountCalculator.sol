// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/**
 * @dev Interface for a calculating the interest amount given a interest rate and principal amount.
 */
interface IFullInterestAmountCalculator {
    /**
     * @notice Calculate the interest due.
     *
     * @dev Interest and principal must be entered as base 10**18
     *
     * @param principal                  Principal amount in the loan terms
     * @param interestRate               Interest rate in the loan terms
     */
    function getFullInterestAmount(uint256 principal, uint256 interestRate) external returns (uint256);
}
