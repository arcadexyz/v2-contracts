// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";

import "../interfaces/ILoanCore.sol";
import "../PromissoryNote.sol";

import "../PromissoryNote.sol";

/**
 * @dev Interface for the LoanCore contract
 */
contract MockLoanCore is ILoanCore, Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    using CountersUpgradeable for CountersUpgradeable.Counter;
    CountersUpgradeable.Counter private loanIdTracker;

    IPromissoryNote public override borrowerNote;
    IPromissoryNote public override lenderNote;
    IERC721 public collateralToken;
    IFeeController public override feeController;

    mapping(uint256 => LoanLibrary.LoanData) public loans;
    mapping(address => mapping(uint160 => bool)) public usedNonces;

    // ========================================== CONSTRUCTOR ===========================================

    /**
     * @notice Runs the initializer function in an upgradeable contract.
     *
     *  @dev Add Unsafe-allow comment to notify upgrades plugin to accept the constructor.
     */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ========================================== INITIALIZER ===========================================

    function initialize(address) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init_unchained();
        borrowerNote = new PromissoryNote("Mock BorrowerNote", "MB");
        lenderNote = new PromissoryNote("Mock LenderNote", "ML");

        borrowerNote.initialize(address(this));
        lenderNote.initialize(address(this));

        // Avoid having loanId = 0
        loanIdTracker.increment();
    }

    // ======================================= UPGRADE AUTHORIZATION ========================================

    /**
     * @notice Authorization function to define who should be allowed to upgrade the contract
     *
     * @param newImplementation           The address of the upgraded verion of this contract
     */

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}



    // ==================================== MOCKLOANCORE OPERATIONS ======================================
    /**
     * @dev Get LoanData by loanId
     */
    function getLoan(uint256 loanId) public view override returns (LoanLibrary.LoanData memory _loanData) {
        return loans[loanId];
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
        LoanLibrary.LoanTerms calldata terms
    ) public override returns (uint256 loanId) {
        loanId = loanIdTracker.current();
        loanIdTracker.increment();

        borrowerNote.mint(borrower, loanId);
        lenderNote.mint(lender, loanId);

        loans[loanId] = LoanLibrary.LoanData(
            LoanLibrary.LoanState.Active,
            0,
            uint160(block.timestamp),
            terms,
            terms.principal,
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
        IERC20Upgradeable(data.terms.payableCurrency).transferFrom(msg.sender, address(this), paymentTotal);
        // use variable.
        data.numInstallmentsPaid += uint24(_numMissedPayments) + 1;
    }

    /**
     * @dev Claim the collateral of the given delinquent loan
     *
     * Requirements:
     *  - The caller must be a holder of the lenderNote
     *  - The loan must be in state Active
     *  - The current time must be beyond the dueDate
     */
    function claim(uint256 loanId, uint256 currentInstallmentPeriod) public override {}

    function isNonceUsed(address user, uint160 nonce) external view override returns (bool) {
        return usedNonces[user][nonce];
    }

    function consumeNonce(address user, uint160 nonce) external override {
        _useNonce(user, nonce);
    }

    function cancelNonce(uint160 nonce) external override {
        address user = msg.sender;
        _useNonce(user, nonce);
    }

    function _useNonce(address user, uint160 nonce) internal {
        require(!usedNonces[user][nonce], "Nonce used");
        usedNonces[user][nonce] = true;

        emit NonceUsed(user, nonce);
    }
}
