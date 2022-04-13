// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "../libraries/LoanLibrary.sol";

interface IOriginationController {

    // ================ Data Types =============

    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // ================ Events =================

    event Approval(address indexed owner, address indexed signer);

    // ============== Origination Operations ==============

    function initializeLoan(
        LoanLibrary.LoanTerms calldata loanTerms,
        address borrower,
        address lender,
        Signature calldata sig
    ) external returns (uint256 loanId);

    function initializeLoanWithItems(
        LoanLibrary.LoanTerms calldata loanTerms,
        address borrower,
        address lender,
        Signature calldata sig,
        LoanLibrary.Predicate[] calldata itemPredicates
    ) external returns (uint256 loanId);

    function initializeLoanWithCollateralPermit(
        LoanLibrary.LoanTerms calldata loanTerms,
        address borrower,
        address lender,
        Signature calldata sig,
        Signature calldata collateralSig,
        uint256 permitDeadline
    ) external returns (uint256 loanId);

    function initializeLoanWithCollateralPermitAndItems(
        LoanLibrary.LoanTerms calldata loanTerms,
        address borrower,
        address lender,
        Signature calldata sig,
        Signature calldata collateralSig,
        uint256 permitDeadline,
        LoanLibrary.Predicate[] calldata itemPredicates
    ) external returns (uint256 loanId);

    // ================ Permission Management =================

    function approve(address signer, bool approved) external;

    function isApproved(address owner, address signer) external returns (bool);

    function isSelfOrApproved(address target, address signer) external returns (bool);

    // ============== Signature Verification ==============

    function recoverTokenSignature(
        LoanLibrary.LoanTerms calldata loanTerms,
        Signature calldata sig
    ) external view returns (address signer);

    function recoverItemsSignature(
        LoanLibrary.LoanTerms calldata loanTerms,
        Signature calldata sig,
        bytes calldata items
    ) external view returns (address signer);
}
