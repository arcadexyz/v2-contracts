// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/utils/Counters.sol";

import "../interfaces/ILoanCore.sol";
import "../interfaces/IPromissoryNote.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../PromissoryNote.sol";

// TODO: Proper natspec

/**
 * @dev Interface for the LoanCore contract
 */
contract MockLoanCore is ILoanCore {
    using Counters for Counters.Counter;
    Counters.Counter private loanIdTracker;

    IPromissoryNote public override borrowerNote;
    IPromissoryNote public override lenderNote;
    IERC721 public collateralToken;
    IFeeController public override feeController;

    mapping(uint256 => LoanLibrary.LoanData) public loans;
    mapping(address => uint160) public lastUsedNonce;

    constructor() {
        borrowerNote = new PromissoryNote("Mock BorrowerNote", "MB");
        lenderNote = new PromissoryNote("Mock LenderNote", "ML");

        // Avoid having loanId = 0
        loanIdTracker.increment();
    }

    /**
     * @dev Get LoanData by loanId
     */
    function getLoan(uint256 loanId) public view override returns (LoanLibrary.LoanData memory _loanData) {
        return loans[loanId];
    }

    /**
     * @dev Create store a loan object with some given terms
     */
    function createLoan(LoanLibrary.LoanTerms calldata terms) external override returns (uint256 loanId) {
        LoanLibrary.LoanTerms memory _loanTerms = LoanLibrary.LoanTerms(
            terms.durationSecs,
            terms.principal,
            terms.interestRate,
            terms.collateralAddress,
            terms.collateralId,
            terms.payableCurrency,
            terms.numInstallments
        );

        LoanLibrary.LoanData memory _loanData = LoanLibrary.LoanData(
            0,
            0,
            _loanTerms,
            LoanLibrary.LoanState.Created,
            terms.durationSecs,
            block.timestamp,
            terms.principal,
            0,
            0,
            0
        );

        loanId = loanIdTracker.current();
        loanIdTracker.increment();

        loans[loanId] = _loanData;

        emit LoanCreated(terms, loanId);

        return loanId;
    }

    /**
     * @dev Start a loan with the given borrower and lender
     *  Distributes the principal less the protocol fee to the borrower
     *
     * Requirements:
     *  - This function can only be called by a whitelisted OriginationController
     *  - The proper principal and collateral must have been sent to this contract before calling.
     */
    function startLoan(
        address lender,
        address borrower,
        uint256 loanId
    ) public override {
        uint256 borrowerNoteId = borrowerNote.mint(borrower, loanId);
        uint256 lenderNoteId = lenderNote.mint(lender, loanId);

        LoanLibrary.LoanData memory data = loans[loanId];
        loans[loanId] = LoanLibrary.LoanData(
            borrowerNoteId,
            lenderNoteId,
            data.terms,
            LoanLibrary.LoanState.Active,
            data.dueDate,
            data.startDate,
            data.terms.principal,
            0,
            0,
            0
        );

        emit LoanStarted(loanId, lender, borrower);
    }

    /**
     * @dev Repay the given loan
     *
     * Requirements:
     *  - The caller must be a holder of the borrowerNote
     *  - The caller must send in principal + interest
     *  - The loan must be in state Active
     */
    function repay(uint256 loanId) public override {
        loans[loanId].state = LoanLibrary.LoanState.Repaid;
        emit LoanRepaid(loanId);
    }

    /**
     * @dev * * * THIS FUNCTION IS NOT VALID SEE LOANCORE REPAYPART FUNCTION!!!
     */
    function repayPart(
        uint256 _loanId,
        uint256 _repaidAmount, // amount paid to principal
        uint256 _numMissedPayments, // number of missed payments (number of payments since the last payment)
        uint256 _paymentToInterest, // any minimum payments to interest
        uint256 _lateFeesAccrued // any minimum payments to late fees
    ) external override {
        LoanLibrary.LoanData storage data = loans[_loanId];
        // Ensure valid initial loan state
        require(data.state == LoanLibrary.LoanState.Active, "LoanCore::repay: Invalid loan state");
        // transfer funds to LoanCore
        uint256 paymentTotal = _repaidAmount + _lateFeesAccrued + _paymentToInterest;
        //console.log("TOTAL PAID FROM BORROWER: ", paymentTotal);
        IERC20(data.terms.payableCurrency).transferFrom(msg.sender, address(this), paymentTotal);
        // use variable.
        data.numInstallmentsPaid = data.numInstallmentsPaid + _numMissedPayments + 1;
    }

    /**
     * @dev Claim the collateral of the given delinquent loan
     *
     * Requirements:
     *  - The caller must be a holder of the lenderNote
     *  - The loan must be in state Active
     *  - The current time must be beyond the dueDate
     */
    function claim(uint256 loanId) public override {}

    function consumeNonce(address user, uint256 nonce) external override {
        require(++lastUsedNonce[user] == nonce, "Invalid nonce");
    }
}
