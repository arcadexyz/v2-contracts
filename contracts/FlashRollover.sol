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
contract FlashRollover is IFlashRollover, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct ERC20Holding {
        address tokenAddress;
        uint256 amount;
    }

    struct ERC721Holding {
        address tokenAddress;
        uint256 tokenId;
    }

    struct ERC1155Holding {
        address tokenAddress;
        uint256 tokenId;
        uint256 amount;
    }

    /* solhint-disable var-name-mixedcase */
    // AAVE Contracts
    // Variable names are in upper case to fulfill IFlashLoanReceiver interface
    ILendingPoolAddressesProvider public immutable override ADDRESSES_PROVIDER;
    ILendingPool public immutable override LENDING_POOL;

    /* solhint-enable var-name-mixedcase */

    address private owner;

    constructor(ILendingPoolAddressesProvider _addressesProvider) {
        ADDRESSES_PROVIDER = _addressesProvider;
        LENDING_POOL = ILendingPool(_addressesProvider.getLendingPool());

        owner = msg.sender;
    }

    function rolloverLoan(
        RolloverContractParams calldata contracts,
        uint256 loanId,
        LoanLibrary.LoanTerms calldata newLoanTerms,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        ILoanCore sourceLoanCore = contracts.sourceLoanCore;
        LoanLibrary.LoanData memory loanData = sourceLoanCore.getLoan(loanId);
        LoanLibrary.LoanTerms memory loanTerms = loanData.terms;

        _validateRollover(sourceLoanCore, contracts.targetLoanCore, loanTerms, newLoanTerms, loanData.borrowerNoteId);

        {
            address[] memory assets = new address[](1);
            assets[0] = loanTerms.payableCurrency;

            uint256[] memory amounts = new uint256[](1);
            amounts[0] = loanTerms.principal + loanTerms.interest;

            uint256[] memory modes = new uint256[](1);
            modes[0] = 0;

            bytes memory params = abi.encode(
                OperationData({ contracts: contracts, loanId: loanId, newLoanTerms: newLoanTerms, v: v, r: r, s: s })
            );

            // Flash loan based on principal + interest
            LENDING_POOL.flashLoan(address(this), assets, amounts, modes, address(this), params, 0);
        }

        // Should not have any funds leftover
        require(IERC20(loanTerms.payableCurrency).balanceOf(address(this)) == 0, "leftover balance");
    }

    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override nonReentrant returns (bool) {
        require(msg.sender == address(LENDING_POOL), "unknown callback sender");
        require(initiator == address(this), "not initiator");

        return _executeOperation(assets, amounts, premiums, abi.decode(params, (OperationData)));
    }

    function _executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        OperationData memory opData
    ) internal returns (bool) {
        OperationContracts memory opContracts = _getContracts(opData.contracts);

        // Get loan details
        LoanLibrary.LoanData memory loanData = opContracts.loanCore.getLoan(opData.loanId);

        address borrower = opContracts.borrowerNote.ownerOf(loanData.borrowerNoteId);
        address lender = opContracts.lenderNote.ownerOf(loanData.lenderNoteId);

        // Do accounting to figure out amount each party needs to receive
        (uint256 flashAmountDue, uint256 needFromBorrower, uint256 leftoverPrincipal) = _ensureFunds(
            amounts[0],
            premiums[0],
            opContracts.feeController.getOriginationFee(),
            opData.newLoanTerms.principal
        );

        IERC20 asset = IERC20(assets[0]);

        if (needFromBorrower > 0) {
            require(asset.balanceOf(borrower) >= needFromBorrower, "borrower cannot pay");
            require(asset.allowance(borrower, address(this)) >= needFromBorrower, "lacks borrower approval");
        }

        _repayLoan(opContracts, loanData, borrower);

        {
            _recreateBundle(opContracts, loanData);

            uint256 newLoanId = _initializeNewLoan(
                opContracts,
                borrower,
                lender,
                loanData.terms.collateralTokenId,
                opData
            );

            emit Rollover(lender, borrower, loanData.terms.collateralTokenId, newLoanId);

            if (address(opData.contracts.sourceLoanCore) != address(opData.contracts.targetLoanCore)) {
                emit Migration(address(opContracts.loanCore), address(opContracts.targetLoanCore), newLoanId);
            }
        }

        if (leftoverPrincipal > 0) {
            asset.safeTransfer(borrower, leftoverPrincipal);
        } else if (needFromBorrower > 0) {
            asset.safeTransferFrom(borrower, address(this), needFromBorrower);
        }

        // Approve all amounts for flash loan repayment
        asset.approve(address(LENDING_POOL), flashAmountDue);

        return true;
    }

    function _ensureFunds(
        uint256 amount,
        uint256 premium,
        uint256 originationFee,
        uint256 newPrincipal
    )
        internal
        pure
        returns (
            uint256 flashAmountDue,
            uint256 needFromBorrower,
            uint256 leftoverPrincipal
        )
    {
        // Make sure new loan, minus pawn fees, can be repaid
        flashAmountDue = amount + premium;
        uint256 willReceive = newPrincipal - ((newPrincipal * originationFee) / 10_000);

        if (flashAmountDue > willReceive) {
            // Not enough - have borrower pay the difference
            needFromBorrower = flashAmountDue - willReceive;
        } else if (willReceive > flashAmountDue) {
            // Too much - will send extra to borrower
            leftoverPrincipal = willReceive - flashAmountDue;
        }

        // Either leftoverPrincipal or needFromBorrower should be 0
        require(leftoverPrincipal == 0 || needFromBorrower == 0, "funds conflict");
    }

    function _repayLoan(
        OperationContracts memory contracts,
        LoanLibrary.LoanData memory loanData,
        address borrower
    ) internal {
        // Take BorrowerNote from borrower
        // Must be approved for withdrawal
        contracts.borrowerNote.transferFrom(borrower, address(this), loanData.borrowerNoteId);

        // Approve repayment
        IERC20(loanData.terms.payableCurrency).approve(
            address(contracts.repaymentController),
            loanData.terms.principal + loanData.terms.interest
        );

        // Repay loan
        contracts.repaymentController.repay(loanData.borrowerNoteId);

        // contract now has asset wrapper but has lost funds
        require(
            contracts.sourceAssetWrapper.ownerOf(loanData.terms.collateralTokenId) == address(this),
            "collateral ownership"
        );
    }

    function _initializeNewLoan(
        OperationContracts memory contracts,
        address borrower,
        address lender,
        uint256 collateralTokenId,
        OperationData memory opData
    ) internal virtual returns (uint256) {
        // approve originationController
        contracts.targetAssetWrapper.approve(address(contracts.originationController), collateralTokenId);

        // start new loan
        // stand in for borrower to meet OriginationController's requirements
        uint256 newLoanId = contracts.originationController.initializeLoan(
            opData.newLoanTerms,
            address(this),
            lender,
            opData.v,
            opData.r,
            opData.s
        );

        LoanLibrary.LoanData memory newLoanData = contracts.targetLoanCore.getLoan(newLoanId);
        contracts.targetBorrowerNote.safeTransferFrom(address(this), borrower, newLoanData.borrowerNoteId);

        return newLoanId;
    }

    function _recreateBundle(
        OperationContracts memory contracts,
        LoanLibrary.LoanData memory loanData
    ) internal returns (uint256 bundleId) {
        uint256 oldBundleId = loanData.terms.collateralTokenId;
        AssetWrapper sourceAssetWrapper = AssetWrapper(address(contracts.sourceAssetWrapper));
        AssetWrapper targetAssetWrapper = AssetWrapper(address(contracts.targetAssetWrapper));

        ERC721Holding[] memory bundleERC721Holdings = new ERC721Holding[](sourceAssetWrapper.numERC721Holdings(bundleId));
        ERC1155Holding[] memory bundleERC1155Holdings = new ERC1155Holding[](sourceAssetWrapper.numERC1155Holdings(bundleId));

        for (uint256 i = 0; i < bundleERC721Holdings.length; i++) {
            (address tokenAddr, uint256 tokenId) = sourceAssetWrapper.bundleERC721Holdings(oldBundleId, i);

            if (tokenAddr == address(0)) {
                break;
            }

            bundleERC721Holdings[i] = ERC721Holding(tokenAddr, tokenId);
        }

        for (uint256 i = 0; i < bundleERC1155Holdings.length; i++) {
            (address tokenAddr, uint256 tokenId, uint256 amount) =
                sourceAssetWrapper.bundleERC1155Holdings(oldBundleId, i);

            if (tokenAddr == address(0)) {
                break;
            }

            bundleERC1155Holdings[i] = ERC1155Holding(tokenAddr, tokenId, amount);
        }

        sourceAssetWrapper.withdraw(oldBundleId);

        targetAssetWrapper.initializeBundleWithId(address(this), oldBundleId);

        for (uint256 i = 0; i < bundleERC721Holdings.length; i++) {
            ERC721Holding memory h = bundleERC721Holdings[i];

            if (h.tokenAddress == address(0)) {
                break;
            }

            IERC721(h.tokenAddress).approve(address(targetAssetWrapper), h.tokenId);
            targetAssetWrapper.depositERC721(h.tokenAddress, h.tokenId, oldBundleId);
        }

        for (uint256 i = 0; i < bundleERC1155Holdings.length; i++) {
            ERC1155Holding memory h = bundleERC1155Holdings[i];

            if (h.tokenAddress == address(0)) {
                break;
            }

            IERC1155(h.tokenAddress).setApprovalForAll(address(targetAssetWrapper), true);
            targetAssetWrapper.depositERC1155(h.tokenAddress, h.tokenId, h.amount, oldBundleId);
        }
    }

    function _getContracts(RolloverContractParams memory contracts) internal returns (OperationContracts memory) {
        return
            OperationContracts({
                loanCore: contracts.sourceLoanCore,
                borrowerNote: contracts.sourceLoanCore.borrowerNote(),
                lenderNote: contracts.sourceLoanCore.lenderNote(),
                feeController: contracts.targetLoanCore.feeController(),
                sourceAssetWrapper: contracts.sourceLoanCore.collateralToken(),
                targetAssetWrapper: contracts.targetLoanCore.collateralToken(),
                repaymentController: contracts.sourceRepaymentController,
                originationController: contracts.targetOriginationController,
                targetLoanCore: contracts.targetLoanCore,
                targetBorrowerNote: contracts.targetLoanCore.borrowerNote()
            });
    }

    function _validateRollover(
        ILoanCore sourceLoanCore,
        ILoanCore targetLoanCore,
        LoanLibrary.LoanTerms memory sourceLoanTerms,
        LoanLibrary.LoanTerms calldata newLoanTerms,
        uint256 borrowerNoteId
    ) internal {
        require(sourceLoanCore.borrowerNote().ownerOf(borrowerNoteId) == msg.sender, "caller not borrower");

        require(newLoanTerms.payableCurrency == sourceLoanTerms.payableCurrency, "currency mismatch");

        require(newLoanTerms.collateralTokenId == sourceLoanTerms.collateralTokenId, "collateral mismatch");
    }

    function setOwner(address _owner) external override {
        require(msg.sender == owner, "not owner");

        owner = _owner;

        emit SetOwner(owner);
    }

    function flushToken(IERC20 token, address to) external override {
        require(msg.sender == owner, "not owner");

        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "no balance");

        token.transfer(to, balance);
    }

    receive() external payable {}
}
