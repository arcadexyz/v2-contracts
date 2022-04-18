// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";

import "./interfaces/IOriginationController.sol";
import "./interfaces/ILoanCore.sol";
import "./interfaces/IERC721Permit.sol";
import "./interfaces/IAssetVault.sol";
import "./interfaces/IVaultFactory.sol";
import "./interfaces/ISignatureVerifier.sol";

import "./verifiers/ItemsVerifier.sol";

import {
    OC_InvalidLoanCore,
    OC_PredicateFailed,
    OC_SelfApprove,
    OC_ApprovedOwnLoan,
    OC_InvalidSignature,
    OC_CallerNotParticipant
} from "./errors/Lending.sol";

// NEXT PR:
// TODO: Tests for approvals and nonce

/**
 * @title OriginationController
 * @author Non-Fungible Technologies, Inc.
 *
 * The Origination Controller is the entry point for all new loans
 * in the Arcade.xyz lending protocol. This contract should have the
 * exclusive responsibility to create new loans in LoanCore. All
 * permissioning, signature verification, and collateral verification
 * takes place in this contract. To originate a loan, the controller
 * also takes custody of both the collateral and loan principal.
 */
contract OriginationController is Context, IOriginationController, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =========================================== ERRORS ==============================================

    // ============================================ STATE ==============================================

    // =================== Constants =====================

    /// @notice EIP712 type hash for bundle-based signatures.
    bytes32 private constant _TOKEN_ID_TYPEHASH =
        keccak256(
            // solhint-disable-next-line max-line-length
            "LoanTerms(uint256 durationSecs,uint256 principal,uint256 interestRate,address collateralAddress,uint256 collateralId,address payableCurrency,uint256 numInstallments,uint160 nonce)"
        );

    /// @notice EIP712 type hash for item-based signatures.
    bytes32 private constant _ITEMS_TYPEHASH =
        keccak256(
            // solhint-disable max-line-length
            "LoanTermsWithItems(uint256 durationSecs,uint256 principal,uint256 interestRate,address collateralAddress,bytes32 itemsHash,address payableCurrency,uint256 numInstallments,uint160 nonce)"
            // "LoanTermsWithItems(uint256 durationSecs,uint256 principal,uint256 interestRate,address collateralAddress,address payableCurrency)"
        );

    // ============= Global Immutable State ==============

    address public immutable loanCore;

    // ================= Approval State ==================

    /// @notice Mapping from owner to operator approvals
    mapping(address => mapping(address => bool)) private _signerApprovals;

    // ========================================== CONSTRUCTOR ===========================================

    /**
     * @notice Creates a new origination controller contract, also initializing
     * the parent signature verifier.
     *
     * @dev For this controller to work, it needs to be granted the ORIGINATOR_ROLE
     *      in loan core after deployment.
     *
     * @param _loanCore                     The address of the loan core logic of the protocol.
     */
    constructor(address _loanCore) EIP712("OriginationController", "2") {
        if (_loanCore == address(0)) revert OC_InvalidLoanCore();
        loanCore = _loanCore;
    }

    // ==================================== ORIGINATION OPERATIONS ======================================

    /**
     * @notice Initializes a loan with Loan Core.
     * @notice Works with either wrapped bundles with an ID, or specific ERC721 unwrapped NFTs.
     *         In that case, collateralAddress should be the token contract.
     *
     * @dev The caller must be a borrower or lender, or approved by a borrower or lender.
     * @dev The external signer must be a borrower or lender, or approved by a borrower or lender.
     * @dev The external signer must come from the opposite side of the loan as the caller.
     *
     * @param loanTerms                     The terms agreed by the lender and borrower.
     * @param borrower                      Address of the borrower.
     * @param lender                        Address of the lender.
     * @param sig                           The loan terms signature, with v, r, s fields, and a nonce.
     *
     * @return loanId                       The unique ID of the new loan.
     */
    function initializeLoan(
        LoanLibrary.LoanTerms calldata loanTerms,
        address borrower,
        address lender,
        Signature calldata sig
    ) public override returns (uint256 loanId) {
        (bytes32 sighash, address externalSigner) = recoverTokenSignature(loanTerms, sig);

        _validateCounterparties(borrower, lender, msg.sender, externalSigner, sig, sighash);

        ILoanCore(loanCore).consumeNonce(externalSigner, sig.nonce);
        loanId = _initialize(loanTerms, borrower, lender);
    }

    /**
     * @notice Initializes a loan with Loan Core.
     * @notice Compared to initializeLoan, this verifies the specific items in a bundle.
     * @notice Only works with bundles implementing the IVaultFactory interface.
     *
     * @dev The caller must be a borrower or lender, or approved by a borrower or lender.
     * @dev The external signer must be a borrower or lender, or approved by a borrower or lender.
     * @dev The external signer must come from the opposite side of the loan as the caller.
     *
     * @param loanTerms                     The terms agreed by the lender and borrower.
     * @param borrower                      Address of the borrower.
     * @param lender                        Address of the lender.
     * @param sig                           The loan terms signature, with v, r, s fields, and a nonce.
     * @param itemPredicates                The predicate rules for the items in the bundle.
     *
     * @return loanId                       The unique ID of the new loan.
     */
    function initializeLoanWithItems(
        LoanLibrary.LoanTerms calldata loanTerms,
        address borrower,
        address lender,
        Signature calldata sig,
        LoanLibrary.Predicate[] calldata itemPredicates
    ) public override returns (uint256 loanId) {
        address vault = IVaultFactory(loanTerms.collateralAddress).instanceAt(loanTerms.collateralId);
        (bytes32 sighash, address externalSigner) = recoverItemsSignature(loanTerms, sig, keccak256(abi.encode(itemPredicates)));

        _validateCounterparties(borrower, lender, msg.sender, externalSigner, sig, sighash);

        for (uint256 i = 0; i < itemPredicates.length; i++) {
            // Verify items are held in the wrapper
            if (
                !IArcadeSignatureVerifier(itemPredicates[i].verifier).verifyPredicates(itemPredicates[i].data, vault)
            ) {
                revert OC_PredicateFailed(
                    itemPredicates[i].verifier,
                    itemPredicates[i].data,
                    vault
                );
            }
        }

        ILoanCore(loanCore).consumeNonce(externalSigner, sig.nonce);
        loanId = _initialize(loanTerms, borrower, lender);
    }

    /**
     * @notice Initializes a loan with Loan Core, with a permit signature instead of pre-approved collateral.
     *
     * @dev The caller must be a borrower or lender, or approved by a borrower or lender.
     * @dev The external signer must be a borrower or lender, or approved by a borrower or lender.
     * @dev The external signer must come from the opposite side of the loan as the caller.
     *
     * @param loanTerms                     The terms agreed by the lender and borrower.
     * @param borrower                      Address of the borrower.
     * @param lender                        Address of the lender.
     * @param sig                           The loan terms signature, with v, r, s fields.
     * @param collateralSig                 The collateral permit signature, with v, r, s fields.
     * @param permitDeadline                The last timestamp for which the signature is valid.
     *
     * @return loanId                       The unique ID of the new loan.
     */
    function initializeLoanWithCollateralPermit(
        LoanLibrary.LoanTerms calldata loanTerms,
        address borrower,
        address lender,
        Signature calldata sig,
        Signature calldata collateralSig,
        uint256 permitDeadline
    ) external override returns (uint256 loanId) {
        IERC721Permit(loanTerms.collateralAddress).permit(
            borrower,
            address(this),
            loanTerms.collateralId,
            permitDeadline,
            collateralSig.v,
            collateralSig.r,
            collateralSig.s
        );

        loanId = initializeLoan(loanTerms, borrower, lender, sig);
    }

    /**
     * @notice Initializes a loan with Loan Core, with a permit signature instead of pre-approved collateral.
     * @notice Compared to initializeLoanWithCollateralPermit, this verifies the specific items in a bundle.
     *
     * @dev The caller must be a borrower or lender, or approved by a borrower or lender.
     * @dev The external signer must be a borrower or lender, or approved by a borrower or lender.
     * @dev The external signer must come from the opposite side of the loan as the caller.
     *
     * @param loanTerms                     The terms agreed by the lender and borrower.
     * @param borrower                      Address of the borrower.
     * @param lender                        Address of the lender.
     * @param sig                           The loan terms signature, with v, r, s fields.
     * @param collateralSig                 The collateral permit signature, with v, r, s fields.
     * @param permitDeadline                The last timestamp for which the signature is valid.
     * @param itemPredicates                The predicate rules for the items in the bundle.
     *
     * @return loanId                       The unique ID of the new loan.
     */
    function initializeLoanWithCollateralPermitAndItems(
        LoanLibrary.LoanTerms calldata loanTerms,
        address borrower,
        address lender,
        Signature calldata sig,
        Signature calldata collateralSig,
        uint256 permitDeadline,
        LoanLibrary.Predicate[] calldata itemPredicates
    ) external override returns (uint256 loanId) {
        IERC721Permit(loanTerms.collateralAddress).permit(
            borrower,
            address(this),
            loanTerms.collateralId,
            permitDeadline,
            collateralSig.v,
            collateralSig.r,
            collateralSig.s
        );

        loanId = initializeLoanWithItems(loanTerms, borrower, lender, sig, itemPredicates);
    }

    // ==================================== PERMISSION MANAGEMENT =======================================

    /**
     * @notice Approve a third party to sign or initialize loans on a counterparties' behalf.
     * @notice Useful to multisig counterparties (who cannot sign themselves) or third-party integrations.
     *
     * @param signer                        The party to set approval for.
     * @param approved                      Whether the party should be approved.
     */
    function approve(address signer, bool approved) public override {
        if (signer == msg.sender) revert OC_SelfApprove(msg.sender);

        _signerApprovals[msg.sender][signer] = approved;

        emit Approval(msg.sender, signer);
    }

    /**
     * @notice Reports whether a party is approved to act on a counterparties' behalf.
     *
     * @param owner                         The grantor of permission.
     * @param signer                        The grantee of permission.
     *
     * @return isApproved                   Whether the grantee has been approved by the grantor.
     */
    function isApproved(address owner, address signer) public view override returns (bool) {
        return _signerApprovals[owner][signer];
    }

    /**
     * @notice Reports whether the signer matches the target or is approved by the target.
     *
     * @param target                        The grantor of permission - should be a smart contract.
     * @param sig                           A struct containing the signature data (for checking EIP-1271).
     * @param sighash                   The hash of the signature payload (used for EIP-1271 check).
     *
     * @return isApprovedForContract        Whether the signer is either the grantor themselves, or approved.
     */
    function isApprovedForContract(address target, Signature calldata sig, bytes32 sighash) public view override returns (bool) {
        bytes memory signature = new bytes(65);

        // Construct byte array directly in assembly for efficiency
        uint8 v = sig.v;
        bytes32 r = sig.r;
        bytes32 s = sig.s;

        assembly {
            mstore(add(signature, 32), r)
            mstore(add(signature, 64), s)
            mstore(add(signature, 96), v)
        }

        // Convert sig struct to bytes
        (bool success, bytes memory result) = target.staticcall(
            abi.encodeWithSelector(IERC1271.isValidSignature.selector, sighash, signature)
        );

        return (success && result.length == 32 && abi.decode(result, (bytes4)) == IERC1271.isValidSignature.selector);
    }

    /**
     * @notice Reports whether the signer matches the target or is approved by the target.
     *
     * @param target                        The grantor of permission.
     * @param signer                        The grantee of permission.
     *
     * @return isSelfOrApproved             Whether the signer is either the grantor themselves, or approved.
     */
    function isSelfOrApproved(address target, address signer) public view override returns (bool) {
        return target == signer || isApproved(target, signer);
    }

    // ==================================== SIGNATURE VERIFICATION ======================================

    /**
     * @notice Determine the external signer for a signature specifying only a collateral address and ID.
     *
     * @param loanTerms                     The terms of the loan.
     * @param sig                           The signature, with v, r, s fields.
     *
     * @return sighash                      The hash that was signed.
     * @return signer                       The address of the recovered signer.
     */
    function recoverTokenSignature(LoanLibrary.LoanTerms calldata loanTerms, Signature calldata sig)
        public
        view
        override
        returns (bytes32 sighash, address signer)
    {
        bytes32 loanHash = keccak256(
            abi.encode(
                _TOKEN_ID_TYPEHASH,
                loanTerms.durationSecs,
                loanTerms.principal,
                loanTerms.interestRate,
                loanTerms.collateralAddress,
                loanTerms.collateralId,
                loanTerms.payableCurrency,
                loanTerms.numInstallments
                sig.nonce
            )
        );

        sighash = _hashTypedDataV4(loanHash);
        signer = ECDSA.recover(sighash, sig.v, sig.r, sig.s);
    }

    /**
     * @notice Determine the external signer for a signature specifying specific items.
     * @dev    Bundle ID should _not_ be included in this signature, because the loan
     *         can be initiated with any arbitrary bundle - as long as the bundle contains the items.
     *
     * @param loanTerms                     The terms of the loan.
     * @param sig                           The loan terms signature, with v, r, s fields.
     * @param itemsHash                     The required items in the specified bundle.
     *
     * @return sighash                      The hash that was signed.
     * @return signer                       The address of the recovered signer.
     */
    function recoverItemsSignature(
        LoanLibrary.LoanTerms calldata loanTerms,
        Signature calldata sig,
        bytes32 itemsHash
    ) public view override returns (bytes32 sighash, address signer) {
        bytes32 loanHash = keccak256(
            abi.encode(
                _ITEMS_TYPEHASH,
                loanTerms.durationSecs,
                loanTerms.principal,
                loanTerms.interestRate,
                loanTerms.collateralAddress,
                itemsHash,
                loanTerms.payableCurrency,
                loanTerms.numInstallments
                sig.nonce
            )
        );

        sighash = _hashTypedDataV4(loanHash);
        signer = ECDSA.recover(sighash, sig.v, sig.r, sig.s);
    }

    // =========================================== HELPERS ==============================================

    /**
     * @dev Ensure that one counterparty has signed the loan terms, and the other
     *      has initiated the transaction.
     *
     * @param borrower                  The specified borrower for the loan.
     * @param lender                    The specified lender for the loan.
     * @param caller                    The address initiating the transaction.
     * @param signer                    The address recovered from the loan terms signature.
     * @param sig                       A struct containing the signature data (for checking EIP-1271).
     * @param sighash                   The hash of the signature payload (used for EIP-1271 check).
     */
    function _validateCounterparties(
        address borrower,
        address lender,
        address caller,
        address signer,
        Signature calldata sig,
        bytes32 sighash
    ) internal view {
        if (caller == signer) revert OC_ApprovedOwnLoan(caller);

        // Make sure one from each side approves
        if (isSelfOrApproved(lender, caller)) {
            if (!isSelfOrApproved(borrower, signer) && !isApprovedForContract(borrower, sig, sighash)) {
                revert OC_InvalidSignature(borrower, signer);
            }
        } else if (isSelfOrApproved(borrower, caller)) {
            if (!isSelfOrApproved(lender, signer) && !isApprovedForContract(lender, sig, sighash)) {
                revert OC_InvalidSignature(lender, signer);
            }
        } else {
            revert OC_CallerNotParticipant(caller);
        }
    }

    /**
     * @dev Perform loan initialization. Take custody of both principal and
     *      collateral, and tell LoanCore to create and start a loan.
     *
     * @param loanTerms                     The terms agreed by the lender and borrower.
     * @param borrower                      Address of the borrower.
     * @param lender                        Address of the lender.
     *
     * @return loanId                       The unique ID of the new loan.
     */
    function _initialize(
        LoanLibrary.LoanTerms calldata loanTerms,
        address borrower,
        address lender
    ) internal nonReentrant returns (uint256 loanId) {
        // Take custody of funds
        IERC20(loanTerms.payableCurrency).safeTransferFrom(lender, address(this), loanTerms.principal);
        IERC20(loanTerms.payableCurrency).approve(loanCore, loanTerms.principal);

        IERC721(loanTerms.collateralAddress).transferFrom(borrower, address(this), loanTerms.collateralId);
        IERC721(loanTerms.collateralAddress).approve(loanCore, loanTerms.collateralId);

        // Start loan
        loanId = ILoanCore(loanCore).createLoan(loanTerms);
        ILoanCore(loanCore).startLoan(lender, borrower, loanId);
    }
}
