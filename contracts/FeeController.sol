// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IFeeController.sol";

import { FC_FeeTooLarge } from "./errors/Lending.sol";

/**
 * @title FeeController
 * @author Non-Fungible Technologies, Inc.
 *
 * The Fee Controller is used by LoanCore to query for fees for different
 * loan lifecycle interactions (origiations, rollovers, etc). All fees should
 * have setters and getters and be expressed in BPs. In the future, this contract
 * could be extended to support more complex logic (introducing a mapping of users
 * who get a discount, e.g.). Since LoanCore can change the fee controller reference,
 * any changes to this contract can be newly deployed on-chain and adopted.
 */
contract FeeController is IFeeController, Ownable {
    // ============================================ STATE ==============================================

    /// @dev Global maximum fees, preventing attacks by owners
    ///      which drain principal.
    uint256 public constant MAX_ORIGINATION_FEE = 1000;
    uint256 public constant MAX_ROLLOVER_FEE = 500;
    uint256 public constant MAX_COLLATERALSALE_FEE = 500;
    uint256 public constant MAX_PAYLATER_FEE = 500;

    /// @dev Fee for origination - default is 0.5%
    uint256 private originationFee = 50;
    /// @dev Fee for rollovers - default is 0.1%
    uint256 private rolloverFee = 10;
    /// @dev Fee for collateral sale - default is 0.0%
    uint256 private collateralSaleFee = 0;
    /// @dev Fee for pay later - default is 0.0%
    uint256 private payLaterFee = 0;

    // ========================================= FEE SETTERS ===========================================

    /**
     * @notice Set the origination fee to the given value. The caller
     *         must be the owner of the contract.
     *
     * @param _originationFee       The new origination fee, in bps.
     */
    function setOriginationFee(uint256 _originationFee) external override onlyOwner {
        if (_originationFee > MAX_ORIGINATION_FEE) revert FC_FeeTooLarge();

        originationFee = _originationFee;
        emit UpdateOriginationFee(_originationFee);
    }

    /**
     * @notice Set the rollover fee to the given value. The caller
     *         must be the owner of the contract.
     *
     * @param _rolloverFee          The new rollover fee, in bps.
     */
    function setRolloverFee(uint256 _rolloverFee) external override onlyOwner {
        if (_rolloverFee > MAX_ROLLOVER_FEE) revert FC_FeeTooLarge();

        rolloverFee = _rolloverFee;
        emit UpdateRolloverFee(_rolloverFee);
    }

    /**
     * @notice Set the collateralSale fee to the given value. The caller
     *         must be the owner of the contract.
     *
     * @param _collateralSaleFee     The new collateralSale fee, in bps.
     */
    function setCollateralSaleFee(uint256 _collateralSaleFee) external override onlyOwner {
        if (_collateralSaleFee > MAX_COLLATERALSALE_FEE) revert FC_FeeTooLarge();

        collateralSaleFee = _collateralSaleFee;
        emit UpdateCollateralSaleFee(_collateralSaleFee);
    }

    /**
     * @notice Set the payLater fee to the given value. The caller
     *         must be the owner of the contract.
     *
     * @param _payLaterFee          The new payLater fee, in bps.
     */
    function setPayLaterFee(uint256 _payLaterFee) external override onlyOwner {
        if (_payLaterFee > MAX_PAYLATER_FEE) revert FC_FeeTooLarge();

        payLaterFee = _payLaterFee;
        emit UpdatePayLaterFee(_payLaterFee);
    }

    // ========================================= FEE GETTERS ===========================================

    /**
     * @notice Get the current origination fee in bps.
     *
     * @return originationFee       The current fee in bps.
     */
    function getOriginationFee() public view override returns (uint256) {
        return originationFee;
    }

    /**
     * @notice Get the current rollover fee in bps.
     *
     * @return rolloverFee       The current fee in bps.
     */
    function getRolloverFee() public view override returns (uint256) {
        return rolloverFee;
    }

    /**
     * @notice Get the current collateralSale fee in bps.
     *
     * @return collateralSaleFee   The current fee in bps.
     */
    function getCollateralSaleFee() public view override returns (uint256) {
        return collateralSaleFee;
    }

    /**
     * @notice Get the current payLater fee in bps.
     *
     * @return payLaterFee   The current fee in bps.
     */
    function getPayLaterFee() public view override returns (uint256) {
        return payLaterFee;
    }
}
