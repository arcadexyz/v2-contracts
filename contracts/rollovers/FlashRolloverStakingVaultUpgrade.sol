// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../external/interfaces/ILendingPool.sol";
import "../interfaces/IFlashRolloverBalancer.sol";
import "../interfaces/ILoanCore.sol";
import "../interfaces/IOriginationController.sol";
import "../interfaces/IRepaymentController.sol";
import "../interfaces/IFeeController.sol";
import "../interfaces/IInstallmentsCalc.sol";

// solhint-disable max-line-length

/**
 * @title FlashRolloverStakingVaultUpgrade
 * @author Non-Fungible Technologies, Inc.
 *
 * Based off Arcade.xyz's V1 lending FlashRollover.
 * Switches from a V2 loan with an old asset vault
 * to a V2 loan with a new asset vault.
 */
contract FlashRolloverStakingVaultUpgrade is ReentrancyGuard, ERC721Holder, ERC1155Holder, IFlashLoanRecipient {
    using SafeERC20 for IERC20;

    event Rollover(address indexed lender, address indexed borrower, uint256 collateralTokenId, uint256 newLoanId);
    event Migration(address indexed oldLoanCore, address indexed newLoanCore, uint256 newLoanId);
    event SetOwner(address owner);


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

    struct VaultRolloverContractParams {
        ILoanCore loanCore;
        IRepaymentController repaymentController;
        IOriginationController originationController;
        IVaultFactory vaultFactory;
        IVaultFactory targetVaultFactory;
    }

    struct OperationData {
        VaultRolloverContractParams contracts;
        uint256 loanId;
        LoanLibrary.LoanTerms newLoanTerms;
        address lender;
        uint160 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct OperationContracts {
        ILoanCore loanCore;
        IERC721 borrowerNote;
        IERC721 lenderNote;
        IFeeController feeController;
        IERC721 sourceAssetWrapper;
        IVaultFactory sourceVaultFactory;
        IVaultFactory targetVaultFactory;
        IRepaymentController repaymentController;
        IOriginationController originationController;
    }

    /* solhint-disable var-name-mixedcase */
    // Balancer Contracts
    IVault public immutable VAULT; // 0xBA12222222228d8Ba445958a75a0704d566BF2C8

    /* solhint-enable var-name-mixedcase */

    address private owner;

    constructor(IVault _vault) {
        VAULT = _vault;

        owner = msg.sender;
    }

    function rolloverLoan(
        VaultRolloverContractParams calldata contracts,
        uint256 loanId,
        LoanLibrary.LoanTerms calldata newLoanTerms,
        address lender,
        uint160 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        LoanLibrary.LoanTerms memory loanTerms = contracts.loanCore.getLoan(loanId).terms;

        {
            _validateRollover(contracts.loanCore, contracts.vaultFactory, contracts.targetVaultFactory, loanTerms, newLoanTerms, loanId);
        }

        {
            IERC20[] memory assets = new IERC20[](1);
            assets[0] = IERC20(loanTerms.payableCurrency);

            uint256[] memory amounts = new uint256[](1);
            amounts[0] = IInstallmentsCalc(address(contracts.loanCore)).getFullInterestAmount(
                loanTerms.principal,
                loanTerms.interestRate
            );

            uint256[] memory modes = new uint256[](1);
            modes[0] = 0;

            bytes memory params = abi.encode(
                OperationData({ contracts: contracts, loanId: loanId, newLoanTerms: newLoanTerms, lender: lender, nonce: nonce, v: v, r: r, s: s })
            );

            // Flash loan based on principal + interest
            VAULT.flashLoan(this, assets, amounts, params);
        }
    }

    function receiveFlashLoan(
        IERC20[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata params
    ) external override nonReentrant {
        require(msg.sender == address(VAULT), "unknown callback sender");

        _executeOperation(assets, amounts, feeAmounts, abi.decode(params, (OperationData)));
    }

    function _executeOperation(
        IERC20[] calldata assets,
        uint256[] calldata amounts,
        uint256[] memory premiums,
        OperationData memory opData
    ) internal returns (bool) {
        OperationContracts memory opContracts = _getContracts(opData.contracts);

        // Get loan details
        LoanLibrary.LoanData memory loanData = opContracts.loanCore.getLoan(opData.loanId);

        address borrower = opContracts.borrowerNote.ownerOf(opData.loanId);
        address lender = opContracts.lenderNote.ownerOf(opData.loanId);

        // Do accounting to figure out amount each party needs to receive
        (uint256 flashAmountDue, uint256 needFromBorrower, uint256 leftoverPrincipal) = _ensureFunds(
            amounts[0],
            premiums[0],
            opContracts.feeController.getOriginationFee(),
            opData.newLoanTerms.principal
        );

        IERC20 asset = assets[0];

        if (needFromBorrower > 0) {
            require(asset.balanceOf(borrower) >= needFromBorrower, "borrower cannot pay");
            require(asset.allowance(borrower, address(this)) >= needFromBorrower, "lacks borrower approval");
        }

        _repayLoan(opContracts, opData.loanId, loanData, borrower);

        {
            _recreateBundle(opContracts, loanData, opData.newLoanTerms.collateralId);

            uint256 newLoanId = _initializeNewLoan(
                opContracts,
                borrower,
                opData.lender,
                opData
            );

            emit Rollover(
                lender,
                borrower,
                loanData.terms.collateralId,
                newLoanId
            );
        }

        if (leftoverPrincipal > 0) {
            asset.safeTransfer(borrower, leftoverPrincipal);
        } else if (needFromBorrower > 0) {
            asset.safeTransferFrom(borrower, address(this), needFromBorrower);
        }

        // Make flash loan repayment
        // Unlike for AAVE, Balancer requires a transfer
        asset.transfer(address(VAULT), flashAmountDue);

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
        uint256 loanId,
        LoanLibrary.LoanData memory loanData,
        address borrower
    ) internal {
        // Take BorrowerNote from borrower
        // Must be approved for withdrawal
        contracts.borrowerNote.transferFrom(borrower, address(this), loanId);

        // Approve repayment
        uint256 repayAmount = IInstallmentsCalc(address(contracts.loanCore)).getFullInterestAmount(
            loanData.terms.principal,
            loanData.terms.interestRate
        );

        IERC20(loanData.terms.payableCurrency).approve(
            address(contracts.repaymentController),
            repayAmount
        );

        // Repay loan
        contracts.repaymentController.repay(loanId);

        // contract now has asset wrapper but has lost funds
        require(
            IERC721(loanData.terms.collateralAddress).ownerOf(loanData.terms.collateralId) == address(this),
            "collateral ownership"
        );
    }

    function _initializeNewLoan(
        OperationContracts memory contracts,
        address borrower,
        address lender,
        OperationData memory opData
    ) internal returns (uint256) {
        uint256 collateralId = opData.newLoanTerms.collateralId;

        // Withdraw vault token
        IERC721(address(contracts.targetVaultFactory)).safeTransferFrom(borrower, address(this), collateralId);

        // approve originationController
        IERC721(address(contracts.targetVaultFactory)).approve(address(contracts.originationController), collateralId);

        // start new loan
        // stand in for borrower to meet OriginationController's requirements
        uint256 newLoanId = contracts.originationController.initializeLoan(
            opData.newLoanTerms,
            address(this),
            lender,
            IOriginationController.Signature({
                v: opData.v,
                r: opData.r,
                s: opData.s
            }),
            opData.nonce
        );

        contracts.borrowerNote.safeTransferFrom(address(this), borrower, newLoanId);

        return newLoanId;
    }

    function _recreateBundle(
        OperationContracts memory contracts,
        LoanLibrary.LoanData memory loanData,
        uint256 vaultId
    ) internal {
        // TODO: Fix this by calling withdrawEnabled on old vault,
        //       then withdrawing everything. Since we cannot enumerate contents,
        //       we need to have them passed by the rollover function.
        //       After withdrawing everythnig, we create a new vault with the new vault
        //       factory, and send all the assets back in.


        uint256 oldBundleId = loanData.terms.collateralTokenId;
        IAssetWrapper sourceAssetWrapper = IAssetWrapper(address(contracts.sourceAssetWrapper));

        /**
         * @dev Only ERC721 and ERC1155 bundle holdings supported (ERC20 and ETH
         *      holdings will be ignored and get stuck). Only 20 of each supported
         *      (any extras will get stuck).
         */
        ERC721Holding[] memory bundleERC721Holdings = new ERC721Holding[](20);
        ERC1155Holding[] memory bundleERC1155Holdings = new ERC1155Holding[](20);

        for (uint256 i = 0; i < bundleERC721Holdings.length; i++) {
            try sourceAssetWrapper.bundleERC721Holdings(oldBundleId, i) returns (address tokenAddr, uint256 tokenId) {
                bundleERC721Holdings[i] = ERC721Holding(tokenAddr, tokenId);
            } catch { break; }
        }

        for (uint256 i = 0; i < bundleERC1155Holdings.length; i++) {
            try sourceAssetWrapper.bundleERC1155Holdings(oldBundleId, i) returns (address tokenAddr, uint256 tokenId, uint256 amount) {
                bundleERC1155Holdings[i] = ERC1155Holding(tokenAddr, tokenId, amount);
            } catch { break; }
        }

        sourceAssetWrapper.withdraw(oldBundleId);

        // Create new asset vault
        address vault = address(uint160(vaultId));

        for (uint256 i = 0; i < bundleERC721Holdings.length; i++) {
            ERC721Holding memory h = bundleERC721Holdings[i];

            if (h.tokenAddress == address(0)) {
                break;
            }

            IERC721(h.tokenAddress).safeTransferFrom(address(this), vault, h.tokenId);
        }

        for (uint256 i = 0; i < bundleERC1155Holdings.length; i++) {
            ERC1155Holding memory h = bundleERC1155Holdings[i];

            if (h.tokenAddress == address(0)) {
                break;
            }

            IERC1155(h.tokenAddress).safeTransferFrom(address(this), vault, h.tokenId, h.amount, bytes(""));
        }
    }

    function _getContracts(VaultRolloverContractParams memory contracts) internal returns (OperationContracts memory) {
        return
            OperationContracts({
                loanCore: contracts.loanCore,
                borrowerNote: contracts.loanCore.borrowerNote(),
                lenderNote: contracts.loanCore.lenderNote(),
                feeController: contracts.loanCore.feeController(),
                sourceVaultFactory: contracts.vaultFactory,
                targetVaultFactory: contracts.targetVaultFactory,
                repaymentController: contracts.repaymentController,
                originationController: contracts.originationController
            });
    }

    function _validateRollover(
        ILoanCore sourceLoanCore,
        IVaultFactory sourceVaultFactory,
        IVaultFactory targetVaultFactory,
        LoanLibrary.LoanTerms memory sourceLoanTerms,
        LoanLibrary.LoanTerms calldata newLoanTerms,
        uint256 borrowerNoteId
    ) internal {
        require(sourceLoanCore.borrowerNote().ownerOf(borrowerNoteId) == msg.sender, "caller not borrower");
        require(newLoanTerms.payableCurrency == sourceLoanTerms.payableCurrency, "currency mismatch");
        require(newLoanTerms.collateralAddress == address(targetVaultFactory), "must target new vault");
        require(sourceLoanTerms.collateralAddress == address(sourceVaultFactory), "must roll over from old vault");
    }

    function setOwner(address _owner) external {
        require(msg.sender == owner, "not owner");

        owner = _owner;

        emit SetOwner(owner);
    }

    function flushToken(IERC20 token, address to) external {
        require(msg.sender == owner, "not owner");

        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "no balance");

        token.transfer(to, balance);
    }

    function flushERC721(IERC721 token, uint256 id, address to) external {
        require(msg.sender == owner, "not owner");

        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "no balance");

        token.transfer(to, balance);
    }

    receive() external payable {}
}