pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./external/interfaces/ILendingPool.sol";

import "./interfaces/IFlashRollover.sol";
import "./interfaces/ILoanCore.sol";
import "./interfaces/IOriginationController.sol";
import "./interfaces/IRepaymentController.sol";
import "./interfaces/IAssetWrapper.sol";
import "./interfaces/IFeeController.sol";

import "./AssetWrapper.sol";
import "./FlashRollover.sol";

/**
 *
 * @dev FlashRollover allows a borrower to roll over
 * a Pawn.fi loan into a new loan without having to
 * repay capital. It integrate with AAVE's flash loans
 * to provide repayment capital, which is then compensated
 * for by the newly-issued loan.
 *
 * Full API docs at docs/FlashRollover.md
 *
 */
contract DelegatedFlashRollover is FlashRollover {
    using SafeERC20 for IERC20;

    constructor(ILendingPoolAddressesProvider _addressesProvider) FlashRollover(_addressesProvider) {}

    /**
     * Initialize new loan from the perspective of the lender
     * NOTE: opData.vrs must be signed by the Borrower
     * NOTE: borrower must `setApprovalForAll` on the newAssetWrapper
     * to the originationController So that the newly created assetwrapper bundle
     * can be withdrawn by originationController
     *
     * Requirements:
     *  Borrower:
     *      - Borrower must have signed v, r, s
     *      - Borrower must have approved approval for all on the new AW to originationcontroller
     *      - Borrower must have approved any excess required funds
     *      - Lender must have approved newPrincipal to originationcontroller
     */
    function _initializeNewLoan(
        OperationContracts memory contracts,
        address borrower,
        address lender,
        uint256 collateralTokenId,
        OperationData memory opData
    ) internal override returns (uint256) {
        // transfer new bundle to the borrower
        // The borrower will have approved it back to the originationcontroller
        contracts.targetAssetWrapper.transferFrom(address(this), borrower, collateralTokenId);
        IERC20(opData.newLoanTerms.payableCurrency).transferFrom(lender, address(this), opData.newLoanTerms.principal);
        IERC20(opData.newLoanTerms.payableCurrency).approve(
            address(contracts.originationController),
            opData.newLoanTerms.principal
        );

        // start new loan
        // stand in for lender to meet OriginationController's requirements
        uint256 newLoanId = contracts.originationController.initializeLoan(
            opData.newLoanTerms,
            borrower,
            address(this),
            opData.v,
            opData.r,
            opData.s
        );

        LoanLibrary.LoanData memory newLoanData = contracts.targetLoanCore.getLoan(newLoanId);
        contracts.targetLoanCore.lenderNote().safeTransferFrom(address(this), lender, newLoanData.lenderNoteId);

        // loan funds went to the borrower so we have to reclaim them
        // so we can pay back the flash loan
        // any extra will be sent back later
        uint256 originationFee = (contracts.feeController.getOriginationFee() * opData.newLoanTerms.principal) / 10_000;
        IERC20(opData.newLoanTerms.payableCurrency).transferFrom(
            borrower,
            address(this),
            opData.newLoanTerms.principal - originationFee
        );

        return newLoanId;
    }
}
