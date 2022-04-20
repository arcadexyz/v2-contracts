// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

library LoanLibrary {
    /**
     * @dev Enum describing the current state of a loan
     * State change flow:
     *  Created -> Active -> Repaid
     *                    -> Defaulted
     */
    enum LoanState {
        // We need a default that is not 'Created' - this is the zero value
        DUMMY_DO_NOT_USE,
        // The loan data is stored, but not initiated yet.
        Created,
        // The loan has been initialized, funds have been delivered to the borrower and the collateral is held.
        Active,
        // The loan has been repaid, and the collateral has been returned to the borrower. This is a terminal state.
        Repaid,
        // The loan was delinquent and collateral claimed by the lender. This is a terminal state.
        Defaulted
    }

    /**
     * @dev The raw terms of a loan
     */
    struct LoanTerms {
        // The number of seconds representing relative due date of the loan
        // *** TEST/ DISCUSSION: A loan of 0 duration has no due date - it is only governed by when the borrower repays?
        uint256 durationSecs;
        // The amount of principal in terms of the payableCurrency
        uint256 principal;
        // Interest in terms of the payableCurrency current principal amount
        // Expressed as a APR (rate), unlike V1 gross value
        // Input conversion: 0.01% = (1 * 10**18) ,  10.00% = (1000 * 10**18)
        uint256 interest;
        // The tokenID of the address holding the collateral
        /// @dev Can be an AssetVault, or the NFT contract for unbundled collateral
        address collateralAddress;
        // The tokenID of the collateral
        uint256 collateralId;
        // The payable currency for the loan principal and interest
        address payableCurrency;
        // Installment loan specific
        // Total number of installment periods within the loan duration
        uint256 numInstallments;
    }

    /**
     * @dev Modification of loan terms, used for signing only.
     *      Instead of a collateralId, a list of predicates
     *      is defined by 'bytes' in items.
     */
    struct LoanTermsWithItems {
        // The number of seconds representing relative due date of the loan
        uint256 durationSecs;
        // The amount of principal in terms of the payableCurrency
        uint256 principal;
        // The amount of interest in terms of the payableCurrency
        uint256 interest;
        // The tokenID of the address holding the collateral
        /// @dev Must be an AssetVault for LoanTermsWithItems
        address collateralAddress;
        // An encoded list of predicates
        bytes items;
        // The payable currency for the loan principal and interest
        address payableCurrency;
        // Installment loan specific
        // Total number of installment periods within the loan duration
        uint256 numInstallments;
    }

    /**
     * @dev Predicate for item-based verifications
     */
    struct Predicate {
        // The encoded predicate, to decoded and parsed by the verifier contract
        bytes data;
        // The verifier contract
        address verifier;
    }

    /**
     * @dev The data of a loan. This is stored once the loan is Active
     */
    struct LoanData {
        // The tokenId of the borrower note
        uint256 borrowerNoteId;
        // The tokenId of the lender note
        uint256 lenderNoteId;
        // The raw terms of the loan
        LoanTerms terms;
        // The current state of the loan
        LoanState state;
        // Timestamp representing absolute due date date of the loan
        uint256 dueDate;
        // installment loan specific
        // Start date of the loan, using block.timestamp - for determining installment period
        uint256 startDate;
        // Remaining balance of the loan. Starts as equal to principal. Can reduce based on
        // payments made, can increased based on compounded interest from missed payments and late fees
        uint256 balance;
        // Amount paid in total by the borrower
        uint256 balancePaid;
        // Total amount of late fees accrued
        uint256 lateFeesAccrued;
        // Number of installment payments made on the loan
        uint256 numInstallmentsPaid;
    }
}
