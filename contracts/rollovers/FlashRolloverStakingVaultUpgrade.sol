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
import "../interfaces/IAssetVault.sol";
import "../vault/OwnableERC721.sol";

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

    /// @dev Enum describing the collateral type of a signature item
    enum CollateralType {
        ERC_721,
        ERC_1155,
        ERC_20,
        PUNKS
    }

    /// @dev Enum describing each item that should be withdrawn from vault
    struct VaultItem {
        // The type of collateral - which interface does it implement
        CollateralType cType;
        // The address of the collateral contract
        address asset;
        // The token ID of the collateral (only applicable to 721 and 1155)
        uint256 tokenId;
        // The minimum amount of collateral (only applicable for 20 and 1155)
        uint256 amount;
    }

    struct OperationData {
        uint256 loanId;
        LoanLibrary.LoanTerms newLoanTerms;
        LoanLibrary.Predicate[] itemPredicates;
        address lender;
        uint160 nonce;
        VaultItem[] vaultItems;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /* solhint-disable var-name-mixedcase */
    // Balancer Contracts
    IVault public immutable VAULT; // 0xBA12222222228d8Ba445958a75a0704d566BF2C8

    /* solhint-enable var-name-mixedcase */

    address private owner;
    uint8 private flashLoanActive;

    // Lending protocol contracts

    ILoanCore public immutable loanCore;
    IPromissoryNote public immutable borrowerNote;
    IPromissoryNote public immutable lenderNote;
    IFeeController public immutable feeController;
    IOriginationController public immutable originationController;
    IRepaymentController public immutable repaymentController;
    IVaultFactory public immutable vaultFactory;
    IVaultFactory public immutable targetVaultFactory;

    constructor(
        IVault _vault,
        ILoanCore _loanCore,
        IRepaymentController _repaymentController,
        IOriginationController _originationController,
        IVaultFactory _vaultFactory,
        IVaultFactory _targetVaultFactory
    ) {
        VAULT = _vault;

        loanCore = _loanCore;
        borrowerNote = _loanCore.borrowerNote();
        lenderNote = _loanCore.lenderNote();
        feeController = _loanCore.feeController();
        originationController = _originationController;
        repaymentController = _repaymentController;
        vaultFactory = _vaultFactory;
        targetVaultFactory = _targetVaultFactory;

        owner = msg.sender;
    }

    function rolloverLoan(
        uint256 loanId,
        LoanLibrary.LoanTerms calldata newLoanTerms,
        address lender,
        uint160 nonce,
        VaultItem[] calldata vaultItems,
        LoanLibrary.Predicate[] calldata itemPredicates,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        LoanLibrary.LoanTerms memory loanTerms = loanCore.getLoan(loanId).terms;

        { _validateRollover(loanTerms, newLoanTerms, loanId); }

        {
            IERC20[] memory assets = new IERC20[](1);
            assets[0] = IERC20(loanTerms.payableCurrency);

            uint256[] memory amounts = new uint256[](1);
            amounts[0] = IInstallmentsCalc(address(loanCore)).getFullInterestAmount(
                loanTerms.principal,
                loanTerms.interestRate
            );

            bytes memory params = abi.encode(
                OperationData(
                    loanId,
                    newLoanTerms,
                    itemPredicates,
                    lender,
                    nonce,
                    vaultItems,
                    v,
                    r,
                    s
                )
            );

            // Flash loan based on principal + interest
            flashLoanActive = 1;
            VAULT.flashLoan(this, assets, amounts, params);
        }
    }

    function receiveFlashLoan(
        IERC20[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata params
    ) external override nonReentrant {
        require(flashLoanActive == 1, "No rollover active");
        require(msg.sender == address(VAULT), "unknown callback sender");

        _executeOperation(assets, amounts, feeAmounts, abi.decode(params, (OperationData)));
    }

    function _executeOperation(
        IERC20[] calldata assets,
        uint256[] calldata amounts,
        uint256[] memory premiums,
        OperationData memory opData
    ) internal returns (bool) {
        // Get loan details
        LoanLibrary.LoanData memory loanData = loanCore.getLoan(opData.loanId);

        address borrower = borrowerNote.ownerOf(opData.loanId);
        address lender = lenderNote.ownerOf(opData.loanId);

        // Do accounting to figure out amount each party needs to receive
        (uint256 flashAmountDue, uint256 needFromBorrower, uint256 leftoverPrincipal) = _ensureFunds(
            amounts[0],
            premiums[0],
            feeController.getOriginationFee(),
            opData.newLoanTerms.principal
        );

        IERC20 asset = assets[0];

        if (needFromBorrower > 0) {
            require(asset.balanceOf(borrower) >= needFromBorrower, "borrower cannot pay");
            require(asset.allowance(borrower, address(this)) >= needFromBorrower, "lacks borrower approval");
        }

        _repayLoan(opData.loanId, loanData, borrower);

        {
            _recreateBundle(
                loanData,
                opData.newLoanTerms.collateralId,
                opData.vaultItems
            );

            uint256 newLoanId = _initializeNewLoan(
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
        flashLoanActive = 2;

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
        uint256 loanId,
        LoanLibrary.LoanData memory loanData,
        address borrower
    ) internal {
        // Take BorrowerNote from borrower
        // Must be approved for withdrawal
        borrowerNote.transferFrom(borrower, address(this), loanId);

        // Approve repayment
        uint256 repayAmount = IInstallmentsCalc(address(loanCore)).getFullInterestAmount(
            loanData.terms.principal,
            loanData.terms.interestRate
        );

        IERC20(loanData.terms.payableCurrency).approve(
            address(repaymentController),
            repayAmount
        );

        // Repay loan
        repaymentController.repay(loanId);

        // contract now has asset wrapper but has lost funds
        require(
            IERC721(loanData.terms.collateralAddress).ownerOf(loanData.terms.collateralId) == address(this),
            "collateral ownership"
        );
    }

    function _initializeNewLoan(
        address borrower,
        address lender,
        OperationData memory opData
    ) internal returns (uint256) {
        uint256 collateralId = opData.newLoanTerms.collateralId;

        // Withdraw vault token
        IERC721(address(targetVaultFactory)).safeTransferFrom(borrower, address(this), collateralId);

        // approve originationController
        IERC721(address(targetVaultFactory)).approve(address(originationController), collateralId);

        // start new loan
        // stand in for borrower to meet OriginationController's requirements
        uint256 newLoanId = originationController.initializeLoanWithItems(
            opData.newLoanTerms,
            address(this),
            lender,
            IOriginationController.Signature({
                v: opData.v,
                r: opData.r,
                s: opData.s
            }),
            opData.nonce,
            opData.itemPredicates
        );

        borrowerNote.safeTransferFrom(address(this), borrower, newLoanId);

        return newLoanId;
    }

    function _recreateBundle(
        LoanLibrary.LoanData memory loanData,
        uint256 newVaultId,
        VaultItem[] memory vaultItems
    ) internal {
        // Enable withdraw on old vault
        uint256 oldVaultId = loanData.terms.collateralId;
        IAssetVault vault = IAssetVault(vaultFactory.instanceAt(oldVaultId));
        vault.enableWithdraw();

        address newVault = targetVaultFactory.instanceAt(newVaultId);

        // Move each vault item from old vault to new vault
        uint256 numVaultItems = vaultItems.length;
        for (uint256 i = 0; i < numVaultItems; i++) {
            VaultItem memory item = vaultItems[i];

            if (item.cType == CollateralType.ERC_721) {
                vault.withdrawERC721(item.asset, item.tokenId, newVault);
            } else if (item.cType == CollateralType.ERC_1155) {
                vault.withdrawERC1155(item.asset, item.tokenId, newVault);
            } else if (item.cType == CollateralType.ERC_20) {
                vault.withdrawERC20(item.asset, newVault);
            } else if (item.cType == CollateralType.PUNKS) {
                vault.withdrawPunk(item.asset, item.tokenId, newVault);
            } else {
                revert("Invalid item type");
            }
        }
    }

    function _validateRollover(
        LoanLibrary.LoanTerms memory sourceLoanTerms,
        LoanLibrary.LoanTerms calldata newLoanTerms,
        uint256 borrowerNoteId
    ) internal view {
        require(borrowerNote.ownerOf(borrowerNoteId) == msg.sender, "caller not borrower");
        require(newLoanTerms.payableCurrency == sourceLoanTerms.payableCurrency, "currency mismatch");
        require(newLoanTerms.collateralAddress == address(targetVaultFactory), "must target new vault");
        require(sourceLoanTerms.collateralAddress == address(vaultFactory), "must roll over from old vault");
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

        token.safeTransferFrom(address(this), to, id);
    }

    function rescueVaultItem(address vault_, VaultItem calldata item, address receiver) external {
        require(msg.sender == owner, "Not owner");

        IAssetVault vault = IAssetVault(vault_);
        IERC721 factory = IERC721(OwnableERC721(vault_).ownershipToken());
        require(factory.ownerOf(uint256(uint160(vault_))) == address(this), "Not vault owner");

        if (item.cType == CollateralType.ERC_721) {
            vault.withdrawERC721(item.asset, item.tokenId, receiver);
        } else if (item.cType == CollateralType.ERC_1155) {
            vault.withdrawERC1155(item.asset, item.tokenId, receiver);
        } else if (item.cType == CollateralType.ERC_20) {
            vault.withdrawERC20(item.asset, receiver);
        } else if (item.cType == CollateralType.PUNKS) {
            vault.withdrawPunk(item.asset, item.tokenId, receiver);
        } else {
            revert("Invalid item type");
        }
    }

    receive() external payable {}
}