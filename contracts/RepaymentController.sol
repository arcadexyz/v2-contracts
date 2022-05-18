// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

/** V2 Notes
 * Interest input as a rate/ percent value.
 *
 * _calcAmountsDue - function which returns the current balanceDue(uint256),
 * defaulted(bool), and payableCurrency(address)
 *
 * repayPartMinimum - function for repaying installment payments. The minimum amount payable.
 * Interest and any fees only.
 *
 * repayPart - function for repaying installment payments. The amount must be higher than
 * the minimum amount payable.
 */

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "hardhat/console.sol";

import "./FullInterestAmountCalc.sol";
import "./libraries/LoanLibrary.sol";
import "./interfaces/IPromissoryNote.sol";
import "./interfaces/ILoanCore.sol";
import "./interfaces/IRepaymentController.sol";

import { RC_CannotDereference, RC_NoPaymentDue, RC_OnlyLender, RC_BeforeStartDate, RC_NoInstallments, RC_NoMinPaymentDue, RC_RepayPartZero, RC_RepayPartLTMin } from "./errors/Lending.sol";

/**
 * @title RepaymentController
 * @author Non-Fungible Technologies, Inc.
 *
 * The Repayment Controller is the entry point for all loan lifecycle
 * operations in the Arcade.xyz lending protocol once a loan has begun.
 * This contract allows a caller to calculate an amount due on a loan,
 * make a payment (either in full or part, for installment loans), and
 * claim collateral on a defaulted loan. It is this contract's responsibility
 * to verify loan conditions before calling LoanCore.
 */
contract RepaymentController is
    IRepaymentController,
    FullInterestAmountCalc,
    AccessControl
{
    using SafeERC20 for IERC20;

    // ============================================ STATE ===============================================

    ILoanCore private loanCore;
    IPromissoryNote private borrowerNote;
    IPromissoryNote private lenderNote;

    // Interest rate parameter
    uint256 public constant INSTALLMENT_PERIOD_MULTIPLIER = 1_000_000;

    // Installment parameters
    // * * * NOTE!!! Finish implementation of grace period
    uint256 public constant GRACE_PERIOD = 604800; // 60*60*24*7 // 1 week
    uint256 public constant LATE_FEE = 50; // 50/BASIS_POINTS_DENOMINATOR = 0.5%

    constructor(
        ILoanCore _loanCore,
        IPromissoryNote _borrowerNote,
        IPromissoryNote _lenderNote
    ) {
        loanCore = _loanCore;
        borrowerNote = _borrowerNote;
        lenderNote = _lenderNote;
    }

    // ==================================== LIFECYCLE OPERATIONS ========================================

    /**
     * @notice Repay an active loan, referenced by borrower note ID (equivalent to loan ID). The interest for a loan
     *         is calculated, and the principal plus interest is withdrawn from the borrower.
     *         Control is passed to LoanCore to complete repayment.
     *
     * @param  loanId               The ID of the loan.
     */
    function repay(uint256 loanId) external override {
        LoanLibrary.LoanTerms memory terms = loanCore.getLoan(loanId).terms;
        if (terms.durationSecs == 0) revert RC_CannotDereference(loanId);

        // withdraw principal plus interest from borrower and send to loan core
        uint256 total = getFullInterestAmount(terms.principal, terms.interestRate);
        if (total == 0) revert RC_NoPaymentDue();

        IERC20(terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), total);
        IERC20(terms.payableCurrency).approve(address(loanCore), total);

        // call repay function in loan core
        loanCore.repay(loanId);
    }

    /**
     * @notice Claim collateral an active loan, referenced by lender note ID (equivalent to loan ID). The loan
     *         must be passed the due date, or, in the case of an installment, the amount
     *         overdue must be beyond the liquidation threshold. No funds are collected
     *         from the borrower.
     *
     * @param  loanId               The ID of the loan.
     */
    function claim(uint256 loanId) external override {
        // make sure that caller owns lender note
        address lender = lenderNote.ownerOf(loanId);
        if (lender != msg.sender) revert RC_OnlyLender(msg.sender);

        // call claim function in loan core
        loanCore.claim(loanId);
    }

    // =========================== INSTALLMENT SPECIFIC OPERATIONS ===============================

    /**
     * @notice Call _calcAmountsDue publicly to determine the amount of the payable currency
     *         must be approved for the payment. Returns minimum balance due, late fees, and number
     *         of missed payments.
     *
     * @dev Calls _calcAmountsDue similar to repayPart and repayPartMinimum, but does not call LoanCore.
     *
     * @param loanId                            LoanId, used to locate terms.
     *
     * @return minInterestDue                   The amount of interest due, compounded over missed payments.
     * @return lateFees                         The amount of late fees due, compounded over missed payments.
     * @return _installmentsMissed              The number of overdue installment periods since the last payment.
     */
    function getInstallmentMinPayment(uint256 loanId)
        public
        view
        override
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        // load terms from loanId
        LoanLibrary.LoanData memory data = loanCore.getLoan(loanId);
        // get loan from borrower note
        if (data.state == LoanLibrary.LoanState.DUMMY_DO_NOT_USE) revert RC_CannotDereference(loanId);

        uint256 startDate = data.startDate;
        if (startDate > block.timestamp) revert RC_BeforeStartDate(startDate);

        uint256 installments = data.terms.numInstallments;
        if (installments == 0) revert RC_NoInstallments(installments);

        // get the current minimum balance due for the installment
        (uint256 minInterestDue, uint256 lateFees, uint256 numMissedPayments) = _calcAmountsDue(
            data.balance,
            startDate,
            data.terms.durationSecs,
            installments,
            data.numInstallmentsPaid,
            data.terms.interestRate
        );

        return (minInterestDue, lateFees, numMissedPayments);
    }

    /**
     * @notice Called when paying back installment loan with the minimum amount due.
     *         Do not call for single payment loan types. Calling this function does not
     *         reduce the loans principal.
     *
     * @dev Only pay off the current interest amount and, if applicable, any late fees accrued.
     *
     * @param loanId                            LoanId, used to locate terms.
     */
    function repayPartMinimum(uint256 loanId) external override {
        // get current minimum balance due for the installment repayment, based on specific loanId.
        (uint256 minBalanceDue, uint256 lateFees, uint256 numMissedPayments) = getInstallmentMinPayment(
            loanId
        );
        // total amount due, interest amount plus any late fees
        uint256 _minAmount = minBalanceDue + lateFees;
        // cannot call repayPartMinimum twice in the same installment period
        if(_minAmount == 0) revert RC_NoPaymentDue();

        // load terms from loanId
        LoanLibrary.LoanData memory data = loanCore.getLoan(loanId);
        // gather minimum payment from _msgSender()
        IERC20(data.terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), _minAmount);
        // approve loanCore to take minBalanceDue
        IERC20(data.terms.payableCurrency).approve(address(loanCore), _minAmount);
        // call repayPart function in loanCore
        loanCore.repayPart(loanId, numMissedPayments, 0, minBalanceDue, lateFees);
    }

    /**
     * @notice Called when paying back installment loan with an amount greater than the minimum amount due.
     *         Do not call for single payment loan types.
     *
     * @dev Pay off the current interest and, if applicable any late fees accrued, and an additional
     *      amount to be deducted from the loan principal.
     *
     * @param loanId                            LoanId, used to locate terms.
     * @param amount                            Amount = minBalDue + lateFees + amountToPayOffPrincipal
     *                                          value must be greater than minBalDue + latefees returned
     *                                          from getInstallmentMinPayment function call.
     */
    function repayPart(uint256 loanId, uint256 amount) external override {
        if (amount == 0) revert RC_RepayPartZero();

        // get current minimum balance due for the installment repayment, based on specific loanId.
        (uint256 minBalanceDue, uint256 lateFees, uint256 numMissedPayments) = getInstallmentMinPayment(
            loanId
        );
        // total minimum amount due, interest amount plus any late fees
        uint256 _minAmount = minBalanceDue + lateFees;
        // require amount taken from the _msgSender() to be larger than or equal to minBalanceDue
        if (amount < _minAmount) revert RC_RepayPartLTMin(amount, _minAmount);
        // load data from loanId
        LoanLibrary.LoanData memory data = loanCore.getLoan(loanId);
        // calculate the payment to principal after subtracting (minBalanceDue + lateFees)
        uint256 _totalPaymentToPrincipal = amount - (_minAmount);
        // gather amount specified in function call params from _msgSender()
        IERC20(data.terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), amount);
        // approve loanCore to take amount
        IERC20(data.terms.payableCurrency).approve(address(loanCore), amount);
        // call repayPart function in loanCore
        loanCore.repayPart(loanId, numMissedPayments, _totalPaymentToPrincipal, minBalanceDue, lateFees);
    }

    /**
     * @notice Called when the user wants to close an installment loan without neededing to deteremine the
     *         amount to pass to the repayPart function. This is done by paying the remaining principal
     *         and any interest or late fees due.
     *
     * @dev Pay off the current interest and, if applicable any late fees accrued, and the remaining principal
     *      left on the loan.
     *
     * @param loanId                            LoanId, used to locate terms.
     */
    function closeLoan(uint256 loanId) external override {
        // get current minimum balance due for the installment repayment, based on specific loanId.
        (uint256 minBalanceDue, uint256 lateFees, uint256 numMissedPayments) = getInstallmentMinPayment(
            loanId
        );
        // load data from loanId
        LoanLibrary.LoanData memory data = loanCore.getLoan(loanId);
        // total amount to close loan (remaining balance + current interest + late fees)
        uint256 _totalAmount = data.balance + minBalanceDue + lateFees;
        // gather amount specified in function call params from _msgSender()
        IERC20(data.terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), _totalAmount);
        // approve loanCore to take minBalanceDue
        IERC20(data.terms.payableCurrency).approve(address(loanCore), _totalAmount);
        // Call repayPart function in loanCore.
        loanCore.repayPart(loanId, numMissedPayments, data.balance, minBalanceDue, lateFees);
    }

    // ========================================= VIEW FUNCTIONS =========================================

    /**
     * @notice Called when the user wants to close an installment loan without needing to determine the
     *         amount to pass to the repayPart function. This is done by paying the remaining principal
     *         and any interest or late fees due.
     *
     * @dev Pay off the current interest and, if applicable any late fees accrued, in addition to any
     *      remaining principal left on the loan.
     *
     * @param loanId                            LoanId, used to locate terms.
     *
     * @return amountDue                        The total amount due to close the loan, including principal, interest,
     *                                          and late fees.
     * @return numMissedPayments                The number of overdue installment periods since the last payment.
     */
    function amountToCloseLoan(uint256 loanId) external view override returns (uint256, uint256) {
        // get current minimum balance due for the installment repayment, based on specific loanId.
        (uint256 minBalanceDue, uint256 lateFees, uint256 numMissedPayments) = getInstallmentMinPayment(
            loanId
        );
        // load data from loanId
        LoanLibrary.LoanData memory data = loanCore.getLoan(loanId);

        // the required total amount needed to close the loan (remaining balance + current interest + late fees)
        return ((data.balance + minBalanceDue + lateFees), numMissedPayments);
    }

    // =========================================== HELPERS ==============================================

    /**
     * @notice Calculates and returns the current installment period relative to the loan's startDate,
     *         durationSecs, and numInstallments. Using these three paremeters and the blocks current timestamp
     *         we are able to determine the current timeframe relative to the total number of installments.
     *
     * @dev Get current installment using the startDate, duration, and current time.
     *      NOTE!!! DurationSecs must be greater than 10 seconds (10%10 = 0).
     *              Also verify the _timestampMultiplier value for what is determined on the max and min loan durations.
     *
     * @param startDate                    The start date of the loan as a timestamp.
     * @param durationSecs                 The duration of the loan in seconds.
     * @param numInstallments              The total number of installments in the loan terms.
     */
    function currentInstallmentPeriod(
        uint256 startDate,
        uint256 durationSecs,
        uint256 numInstallments
    ) internal view returns (uint256) {
        // *** Local State
        uint256 _currentTime = block.timestamp;
        uint256 _installmentPeriod = 1; // can only be called after the loan has started
        uint256 _relativeTimeInLoan = 0; // initial value
        uint256 _timestampMultiplier = 1e20; // inital value

        // *** Get Timestamp Mulitpier
        for (uint256 i = 1e18; i >= 10; i = i / 10) {
            if (durationSecs % i != durationSecs) {
                if (_timestampMultiplier == 1e20) {
                    _timestampMultiplier = (1e18 / i);
                }
            }
        }

        // *** Time Per Installment
        uint256 _timePerInstallment = durationSecs / numInstallments;

        // *** Relative Time In Loan
        _relativeTimeInLoan = (_currentTime - startDate) * _timestampMultiplier;

        // *** Check to see when _timePerInstallment * i is greater than _relativeTimeInLoan
        // Used to determine the current installment period. (j+1 to account for the current period)
        uint256 j = 1;
        while ((_timePerInstallment * j) * _timestampMultiplier <= _relativeTimeInLoan) {
            _installmentPeriod = j + 1;
            j++;
        }
        // *** Return
        return (_installmentPeriod);
    }

    /**
     * @notice Calculates and returns the compounded fees and minimum balance for all the missed payments
     *
     * @dev Get minimum installment payment due, and any late fees accrued due to payment being late
     *
     * @param balance                           Current balance of the loan
     * @param _interestRatePerInstallment       Interest rate per installment period
     * @param _installmentsMissed               Number of missed installment periods
     */
    function _getFees(
        uint256 balance,
        uint256 _interestRatePerInstallment,
        uint256 _installmentsMissed
    ) internal pure returns (uint256, uint256) {
        uint256 minInterestDue = 0; // initial state
        uint256 currentBal = balance; // remaining principal
        uint256 lateFees = 0; // initial state
        // calculate the late fees based on number of installments missed
        // late fees compound on any installment periods missed. For consecutive missed payments
        // late fees of first installment missed are added to the principal of the next late fees calculation
        for (uint256 i = 0; i < _installmentsMissed; i++) {
            // interest due per period based on currentBal value
            uint256 intDuePerPeriod = (((currentBal * _interestRatePerInstallment) / INSTALLMENT_PERIOD_MULTIPLIER) /
                BASIS_POINTS_DENOMINATOR);
            // update local state, next interest payment and late fee calculated off updated currentBal variable
            minInterestDue += intDuePerPeriod;
            lateFees += ((currentBal * LATE_FEE) / BASIS_POINTS_DENOMINATOR);
            currentBal += intDuePerPeriod + lateFees;
        }

        // one additional interest period added to _installmentsMissed for the current payment being made.
        // no late fees added to this payment. currentBal compounded.
        minInterestDue +=
            ((currentBal * _interestRatePerInstallment) / INSTALLMENT_PERIOD_MULTIPLIER) /
            BASIS_POINTS_DENOMINATOR;

        return (minInterestDue, lateFees);
    }

    /**
     * @notice Calulates and returns the minimum interest balance on loan, current late fees,
     *         and the current number of payments missed. If called twice in the same installment
     *         period, will return all zeros the second call.
     *
     * @dev Get minimum installment payment due, any late fees accrued, and
     *      the number of missed payments since last installment payment.
     *
     *      1. Calculate relative time values to determine the number of installment periods missed.
     *      2. Is the repayment late based on the number of installment periods missed?
     *          Y. Calculate minimum balance due with late fees.
     *          N. Return only interest rate payment as minimum balance due.
     *
     * @param balance                           Current balance of the loan
     * @param startDate                         Timestamp of the start of the loan duration
     * @param durationSecs                      Duration of the loan in seconds
     * @param numInstallments                   Total number of installments in the loan
     * @param numInstallmentsPaid               Total number of installments paid, not including this current payment
     * @param interestRate                      The total interest rate for the loans duration from the loan terms
     */
    function _calcAmountsDue(
        uint256 balance,
        uint256 startDate,
        uint256 durationSecs,
        uint256 numInstallments,
        uint256 numInstallmentsPaid,
        uint256 interestRate
    )
        internal
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        // *** Installment Time
        uint256 _installmentPeriod = currentInstallmentPeriod(startDate, durationSecs, numInstallments);

        // *** Time related to number of installments paid
        if (numInstallmentsPaid >= _installmentPeriod) {
            // When numInstallmentsPaid is greater than or equal to the _installmentPeriod
            // this indicates that the minimum interest and any late fees for this installment period
            // have alread been repaid. Any additional amount sent in this installment period goes to principal
            return (0, 0, 0);
        } else {
            // +1 for current install payment
            uint256 _installmentsMissed = _installmentPeriod - (numInstallmentsPaid + 1);

            // ** Installment Interest - using mulitpier of 1 million.
            // There should not be loan with more than 1 million installment periods. Checked in LoanCore.
            uint256 _interestRatePerInstallment = ((interestRate / INTEREST_RATE_DENOMINATOR) *
                INSTALLMENT_PERIOD_MULTIPLIER) / numInstallments;

            // ** Determine if late fees are added and if so, how much?
            // Calulate number of payments missed based on _latePayment, _pastDueDate

            // * If payment on time...
            if (_installmentsMissed == 0) {
                // Minimum balance due calculation. Based on interest per installment period
                uint256 minBalDue = ((balance * _interestRatePerInstallment) / INSTALLMENT_PERIOD_MULTIPLIER) /
                    BASIS_POINTS_DENOMINATOR;

                return (minBalDue, 0, 0);
            }
            // * If payment is late, or past the loan duration...
            else {
                // get late fees based on number of payments missed and current principal due
                (uint256 minInterestDue, uint256 lateFees) = _getFees(
                    balance,
                    _interestRatePerInstallment,
                    _installmentsMissed
                );

                return (minInterestDue, lateFees, _installmentsMissed);
            }
        }
    }
}