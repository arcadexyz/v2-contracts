// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./interfaces/IFullInterestAmountCalc.sol";

/**
 * @dev Interface for a calculating the interest amount given a interest rate and principal amount
 *
 */
abstract contract FullInterestAmountCalc is IFullInterestAmountCalc {
    uint256 private totalInterestAmount = 0;

    /**
     * @inheritdoc IFullInterestAmountCalc
     */
    function getFullInterestAmount(uint256 principal, uint256 interestRate) public view virtual returns (uint256) {
        return totalInterestAmount;
    }
}
