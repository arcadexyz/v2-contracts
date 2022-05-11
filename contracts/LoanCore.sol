// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;


import "./FullInterestAmountCalc.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/CountersUpgradeable.sol";

import "./interfaces/ICallDelegator.sol";
import "./interfaces/IPromissoryNote.sol";
import "./interfaces/IAssetVault.sol";
import "./interfaces/IFeeController.sol";
import "./interfaces/ILoanCore.sol";
import "./PromissoryNote.sol";
import "./vault/OwnableERC721.sol";

import { LC_LoanDuration, LC_CollateralInUse, LC_InterestRate, LC_NumberInstallments, LC_StartInvalidState, LC_NotExpired, LC_BalanceGTZero, LC_NonceUsed } from "./errors/Lending.sol";


// TODO: Better natspec
// TODO: Custom errors

/**
 * @dev LoanCore contract - core contract for creating, repaying, and claiming collateral for PawnFi loans

 */

contract LoanCore is ILoanCore, Initializable, FullInterestAmountCalc,  AccessControlUpgradeable, PausableUpgradeable, ICallDelegator, UUPSUpgradeable {

    using CountersUpgradeable for CountersUpgradeable.Counter;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using SafeMathUpgradeable for uint256;

    bytes32 public constant ORIGINATOR_ROLE = keccak256("ORIGINATOR_ROLE");
    bytes32 public constant REPAYER_ROLE = keccak256("REPAYER_ROLE");
    bytes32 public constant FEE_CLAIMER_ROLE = keccak256("FEE_CLAIMER_ROLE");

    CountersUpgradeable.Counter private loanIdTracker;
    mapping(uint256 => LoanLibrary.LoanData) private loans;
    mapping(address => mapping(uint256 => bool)) private collateralInUse;
    mapping(address => mapping(uint160 => bool)) public usedNonces;
    IPromissoryNote public override borrowerNote;
    IPromissoryNote public override lenderNote;
    IFeeController public override feeController;

    // 10k bps per whole
    uint256 private constant BPS_DENOMINATOR = 10_000;

    // ========================================== CONSTRUCTOR ===========================================

    /**
     * @notice Runs the initializer function in an upgradeable contract.
     *
     *  @dev Add Unsafe-allow comment to notify upgrades plugin to accept the constructor.
     */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    // ========================================== INITIALIZER ===========================================

    /**
     * @notice Creates a new origination controller contract, also initializing
     * the parent signature verifier.
     *
     * @dev For this controller to work, it needs to be granted the ORIGINATOR_ROLE
     *      in loan core after deployment.
     *
     * @param _feeController      The address of the origination fee contract of the protocol.
     */

    function initialize(IFeeController _feeController) public initializer {
        // only those with FEE_CLAIMER_ROLE can update or grant FEE_CLAIMER_ROLE
        __AccessControl_init();
        __UUPSUpgradeable_init_unchained();
        _setRoleAdmin(FEE_CLAIMER_ROLE, FEE_CLAIMER_ROLE);
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(FEE_CLAIMER_ROLE, _msgSender());

        feeController = _feeController;

        // TODO: Why are these deployed? Can these be provided beforehand?
        //       Even updatable with note addresses going in LoanData?
        borrowerNote = new PromissoryNote("PawnFi Borrower Note", "pBN");
        lenderNote = new PromissoryNote("PawnFi Lender Note", "pLN");

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



    // ==================================== LOANCORE OPERATIONS ======================================

    /**
     * @inheritdoc ILoanCore
     */
    function getLoan(uint256 loanId) external view override returns (LoanLibrary.LoanData memory loanData) {
        return loans[loanId];
    }

    /**
     * @inheritdoc ILoanCore
     */
    function createLoan(LoanLibrary.LoanTerms calldata terms)
        external
        override
        whenNotPaused
        onlyRole(ORIGINATOR_ROLE)
        returns (uint256 loanId)
    {
        // loan duration must be greater than 1 hr and less than 3 years
        if(terms.durationSecs < 3600 || terms.durationSecs > 94608000) revert LC_LoanDuration(terms.durationSecs);
        // check collateral is not already used in a loan.
        if(collateralInUse[terms.collateralAddress][terms.collateralId] == true ) revert LC_CollateralInUse(terms.collateralAddress, terms.collateralId);
        // interest rate must be greater than or equal to 0.01%
        if(terms.interestRate / INTEREST_RATE_DENOMINATOR < 1) revert LC_InterestRate(terms.interestRate);
        // number of installments must be an even number.
        if(terms.numInstallments % 2 != 0 || terms.numInstallments > 1000000) revert LC_NumberInstallments(terms.numInstallments);

        // get current loanId and increment for next function call
        loanId = loanIdTracker.current();
        loanIdTracker.increment();
        // Using loanId, set inital LoanData state
        loans[loanId] = LoanLibrary.LoanData({
            borrowerNoteId: 0,
            lenderNoteId: 0,
            terms: terms,
            state: LoanLibrary.LoanState.Created,
            dueDate: block.timestamp + terms.durationSecs,
            startDate: block.timestamp,
            balance: terms.principal,
            balancePaid: 0,
            lateFeesAccrued: 0,
            numInstallmentsPaid: 0
        });
        // set collateral to in use.
        collateralInUse[terms.collateralAddress][terms.collateralId] = true;

        emit LoanCreated(terms, loanId);
    }

    /**
     * @inheritdoc ILoanCore
     */
    function startLoan(
        address lender,
        address borrower,
        uint256 loanId
    ) external override whenNotPaused onlyRole(ORIGINATOR_ROLE) {
        LoanLibrary.LoanData memory data = loans[loanId];

        // Ensure valid initial loan state
        if(data.state != LoanLibrary.LoanState.Created) revert LC_StartInvalidState(data.state);

        // Pull collateral token and principal
        IERC721(data.terms.collateralAddress).transferFrom(_msgSender(), address(this), data.terms.collateralId);
        IERC20Upgradeable(data.terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), data.terms.principal);

        // Distribute notes and principal, initiate loan state
        loans[loanId].state = LoanLibrary.LoanState.Active;
        uint256 borrowerNoteId = borrowerNote.mint(borrower, loanId);
        uint256 lenderNoteId = lenderNote.mint(lender, loanId);

        loans[loanId] = LoanLibrary.LoanData(
            borrowerNoteId,
            lenderNoteId,
            data.terms,
            LoanLibrary.LoanState.Active,
            data.dueDate,
            data.startDate,
            data.balance,
            data.balancePaid,
            data.lateFeesAccrued,
            data.numInstallmentsPaid
        );

        IERC20Upgradeable(data.terms.payableCurrency).safeTransfer(borrower, getPrincipalLessFees(data.terms.principal));

        emit LoanStarted(loanId, lender, borrower);
    }

    /**
     * @inheritdoc ILoanCore
     */
    function repay(uint256 loanId) external override onlyRole(REPAYER_ROLE) {
        LoanLibrary.LoanData memory data = loans[loanId];
        // ensure valid initial loan state when starting loan
        if(data.state != LoanLibrary.LoanState.Active) revert LC_StartInvalidState(data.state);

        uint256 returnAmount = getFullInterestAmount(data.terms.principal, data.terms.interestRate);
        // ensure balance to be paid is greater than zero
        if(returnAmount <= 0) revert LC_BalanceGTZero(returnAmount);
        // transfer from msg.sender to this contract
        IERC20Upgradeable(data.terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), returnAmount);
        // get promissory notes from two parties involved
        address lender = lenderNote.ownerOf(data.lenderNoteId);
        address borrower = borrowerNote.ownerOf(data.borrowerNoteId);

        // state changes and cleanup
        // NOTE: these must be performed before assets are released to prevent reentrance
        loans[loanId].state = LoanLibrary.LoanState.Repaid;
        collateralInUse[data.terms.collateralAddress][data.terms.collateralId] = false;

        lenderNote.burn(data.lenderNoteId);
        borrowerNote.burn(data.borrowerNoteId);

        // asset and collateral redistribution
        IERC20Upgradeable(data.terms.payableCurrency).safeTransfer(lender, returnAmount);
        IERC721(data.terms.collateralAddress).transferFrom(address(this), borrower, data.terms.collateralId);

        emit LoanRepaid(loanId);
    }

    /**
     * @inheritdoc ILoanCore
     */
    function claim(uint256 loanId) external override whenNotPaused onlyRole(REPAYER_ROLE) {
        LoanLibrary.LoanData memory data = loans[loanId];
        // ensure valid initial loan state when starting loan
        if(data.state == LoanLibrary.LoanState.Active) revert LC_StartInvalidState(data.state);
        // ensure claiming after the loan has ended. block.timstamp must be greater than the dueDate.
        if(data.dueDate > block.timestamp) revert LC_NotExpired(data.dueDate);

        address lender = lenderNote.ownerOf(data.lenderNoteId);

        // NOTE: these must be performed before assets are released to prevent reentrance
        loans[loanId].state = LoanLibrary.LoanState.Defaulted;
        collateralInUse[data.terms.collateralAddress][data.terms.collateralId] = false;

        lenderNote.burn(data.lenderNoteId);
        borrowerNote.burn(data.borrowerNoteId);

        // collateral redistribution
        IERC721(data.terms.collateralAddress).transferFrom(address(this), lender, data.terms.collateralId);

        emit LoanClaimed(loanId);
    }

    /**

     * Take a principal value and return the amount less protocol fees
     */
    function getPrincipalLessFees(uint256 principal) internal view returns (uint256) {
        return principal.sub(principal.mul(feeController.getOriginationFee()).div(BPS_DENOMINATOR));
    }

    // ======================== INSTALLMENT SPECIFIC OPERATIONS =============================

    /**
     * @dev Called from RepaymentController when paying back an installment loan.
     * New loan state parameters are calculated in the Repayment Controller.
     * Based on if the _paymentToPrincipal is greater than the current balance
     * the loan state is updated. (0 = minimum payment sent, > 0 pay down principal)
     * The paymentTotal (_paymentToPrincipal + _paymentToLateFees) is always transferred to the lender.
     *
     * @param _loanId                       Used to get LoanData
     * @param _paymentToPrincipal           Amount sent in addition to minimum amount due, used to pay down principal
     * @param _currentMissedPayments        Number of payments missed since the last isntallment payment
     * @param _paymentToLateFees            Amount due in only late fees.
     */
    function repayPart(
        uint256 _loanId,
        uint256 _currentMissedPayments,
        uint256 _paymentToPrincipal,
        uint256 _paymentToInterest,
        uint256 _paymentToLateFees
    ) external override onlyRole(REPAYER_ROLE) {
        LoanLibrary.LoanData storage data = loans[_loanId];
        // ensure valid initial loan state when repaying loan
        if(data.state != LoanLibrary.LoanState.Active) revert LC_StartInvalidState(data.state);
        // calculate total sent by borrower and transferFrom repayment controller to this address
        uint256 paymentTotal = _paymentToPrincipal + _paymentToLateFees + _paymentToInterest;
        IERC20Upgradeable(data.terms.payableCurrency).safeTransferFrom(_msgSender(), address(this), paymentTotal);
        // get the lender and borrower
        address lender = lenderNote.ownerOf(data.lenderNoteId);
        address borrower = borrowerNote.ownerOf(data.borrowerNoteId);
        // update common state
        data.lateFeesAccrued = data.lateFeesAccrued + _paymentToLateFees;
        data.numInstallmentsPaid = data.numInstallmentsPaid + _currentMissedPayments + 1;

        // * If payment sent is exact or extra than remaining principal
        if (_paymentToPrincipal > data.balance || _paymentToPrincipal == data.balance) {
            // set the loan state to repaid
            data.state = LoanLibrary.LoanState.Repaid;
            collateralInUse[data.terms.collateralAddress][data.terms.collateralId] = false;

            // state changes and cleanup
            lenderNote.burn(data.lenderNoteId);
            borrowerNote.burn(data.borrowerNoteId);

            // return the difference to borrower
            if (_paymentToPrincipal > data.balance) {
                uint256 diffAmount = _paymentToPrincipal - data.balance;
                // update balance state balancePaid is the current principal
                data.balance = 0;
                data.balancePaid += paymentTotal - diffAmount;
                // update paymentTotal since extra amount sent
                IERC20Upgradeable(data.terms.payableCurrency).safeTransfer(borrower, diffAmount);
                // Loan is fully repaid, redistribute asset and collateral.
                IERC20Upgradeable(data.terms.payableCurrency).safeTransfer(lender, paymentTotal - diffAmount);
                IERC721(data.terms.collateralAddress).transferFrom(address(this), borrower, data.terms.collateralId);
            }
            // exact amount sent, no difference calculation necessary
            else {
                // update balance
                data.balance = 0;
                data.balancePaid += paymentTotal;
<<<<<<< HEAD
                // Loan is fully repaid, redistribute asset and collateral.
                IERC20Upgradeable(data.terms.payableCurrency).safeTransfer(lender, paymentTotal);
=======
                // loan is fully repaid, redistribute asset and collateral.
                IERC20(data.terms.payableCurrency).safeTransfer(lender, paymentTotal);
>>>>>>> 745b93f (docs(.sol errors): loanCore, PromissoryNote, FILC, ERC721P, and punk router errors created)
                IERC721(data.terms.collateralAddress).transferFrom(address(this), borrower, data.terms.collateralId);
            }

            emit LoanRepaid(_loanId);
        }
        // * Else, (mid loan payment)
        else {
            // update balance state
            data.balance -= _paymentToPrincipal;
            data.balancePaid += paymentTotal;

<<<<<<< HEAD
            // Loan partial payment, redistribute asset to lender.
            IERC20Upgradeable(data.terms.payableCurrency).safeTransfer(lender, paymentTotal);
=======
            // loan partial payment, redistribute asset to lender.
            IERC20(data.terms.payableCurrency).safeTransfer(lender, paymentTotal);
>>>>>>> 745b93f (docs(.sol errors): loanCore, PromissoryNote, FILC, ERC721P, and punk router errors created)

            // minimum repayment events will emit 0 and unchanged principal
            emit InstallmentPaymentReceived(_loanId, _paymentToPrincipal, data.balance);
        }
    }

    // ============================= ADMIN FUNCTIONS ==================================

    /**
     * @dev Set the fee controller to a new value
     *
     * Requirements:
     *
     * - Must be called by the owner of this contract
     */
    function setFeeController(IFeeController _newController) external onlyRole(FEE_CLAIMER_ROLE) {
        feeController = _newController;
    }

    /**
     * @dev Claim the protocol fees for the given token
     *
     * @param token - The address of the ERC20 token to claim fees for
     *
     * Requirements:
     *
     * - Must be called by the owner of this contract
     */
    function claimFees(IERC20Upgradeable token) external onlyRole(FEE_CLAIMER_ROLE) {
        // any token balances remaining on this contract are fees owned by the protocol
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(_msgSender(), amount);
        emit FeesClaimed(address(token), _msgSender(), amount);
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @inheritdoc ICallDelegator
     */
    function canCallOn(address caller, address vault) external view override returns (bool) {
        // if the collateral is not currently being used in a loan, disallow
        if (!collateralInUse[OwnableERC721(vault).ownershipToken()][uint256(uint160(vault))]) {
            return false;
        }

        for (uint256 i = 0; i < borrowerNote.balanceOf(caller); i++) {
            uint256 borrowerNoteId = borrowerNote.tokenOfOwnerByIndex(caller, i);
            uint256 loanId = borrowerNote.loanIdByNoteId(borrowerNoteId);
            // if the borrower is currently borrowing against this vault,
            // return true
            if (loans[loanId].terms.collateralId == uint256(uint160(vault))) {
                return true;
            }
        }
        return false;
    }

    function consumeNonce(address user, uint160 nonce) external override whenNotPaused onlyRole(ORIGINATOR_ROLE) {
        _useNonce(user, nonce);
    }

    function cancelNonce(uint160 nonce) external override {
        address user = _msgSender();
        _useNonce(user, nonce);
    }

    function _useNonce(address user, uint160 nonce) internal {
        if(usedNonces[user][nonce] == true) revert LC_NonceUsed(user, nonce);
        // set nonce to used
        usedNonces[user][nonce] = true;

        emit NonceUsed(user, nonce);
    }
}
