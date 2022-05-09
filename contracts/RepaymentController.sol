// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/IERC165Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "./libraries/LoanLibrary.sol";
import "./interfaces/IPromissoryNote.sol";
import "./interfaces/ILoanCore.sol";
import "./interfaces/IRepaymentController.sol";

contract RepaymentController is IRepaymentController, Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    ILoanCore private loanCore;
    IPromissoryNote private borrowerNote;
    IPromissoryNote private lenderNote;

    // ========================================== CONSTRUCTOR ===========================================

    /**
     * @notice Runs the initializer function in an upgradeable contract.
     *
     *  @dev Add Unsafe-allow comment to notify upgrades plugin to accept the constructor.
     */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ========================================== INITIALIZER ===========================================

    function initialize(
        ILoanCore _loanCore,
        IPromissoryNote _borrowerNote,
        IPromissoryNote _lenderNote
    ) initializer public {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        loanCore = _loanCore;
        borrowerNote = _borrowerNote;
        lenderNote = _lenderNote;
    }

    // ======================================= UPGRADE AUTHORIZATION ========================================

    /**
     * @notice Authorization function to define who should be allowed to upgrade the contract
     *
     * @param newImplementation           The address of the upgraded verion of this contract
     */

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}


    // ==================================== CONTROLLER OPERATIONS ======================================

    /**
     * @inheritdoc IRepaymentController
     */
    function repay(uint256 borrowerNoteId) external override {
        // get loan from borrower note
        uint256 loanId = borrowerNote.loanIdByNoteId(borrowerNoteId);

        require(loanId != 0, "RepaymentController: repay could not dereference loan");

        LoanLibrary.LoanTerms memory terms = loanCore.getLoan(loanId).terms;

        // withdraw principal plus interest from borrower and send to loan core

        IERC20Upgradeable(terms.payableCurrency).safeTransferFrom(msg.sender, address(this), terms.principal.add(terms.interest));
        IERC20Upgradeable(terms.payableCurrency).approve(address(loanCore), terms.principal.add(terms.interest));

        // call repay function in loan core
        loanCore.repay(loanId);
    }

    /**
     * @inheritdoc IRepaymentController
     */
    function claim(uint256 lenderNoteId) external override {
        // make sure that caller owns lender note
        address lender = lenderNote.ownerOf(lenderNoteId);
        require(lender == msg.sender, "RepaymentController: not owner of lender note");

        // get loan from lender note
        uint256 loanId = lenderNote.loanIdByNoteId(lenderNoteId);
        require(loanId != 0, "RepaymentController: claim could not dereference loan");

        // call claim function in loan core
        loanCore.claim(loanId);
    }
}
