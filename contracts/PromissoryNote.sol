// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import "./ERC721Permit.sol";
import "./interfaces/ILoanCore.sol";
import "./interfaces/IPromissoryNote.sol";

import { PN_MintingRole, PN_BurningRole, PN_ContractPaused } from "./errors/Lending.sol";

/**
 * @title PromissoryNote
 * @author Non-Fungible Technologies, Inc.
 *
 * Built off Openzeppelin's ERC721PresetMinterPauserAutoId. Used for
 * representing rights and obligations in the context of a loan - the
 * right to claim collateral for lenders (instantiated as LenderNote),
 * and the right to recover collateral upon repayment for borrowers
 * (instantiated as BorrowerNote).
 *
 * @dev {ERC721} token, including:
 *
 *  - ability for holders to burn (destroy) their tokens
 *  - a minter role that allows for token minting (creation)
 *  - token ID and URI autogeneration
 *
 * This contract uses {AccessControl} to lock permissioned functions using the
 * different roles - head to its documentation for details.
 *
 * The account that deploys the contract will be granted the minter and pauser
 * roles, as well as the default admin role, which will let it grant both minter
 * and pauser roles to other accounts.
 */
contract PromissoryNote is
    Context,
    AccessControlEnumerable,
    ERC721Enumerable,
    ERC721Pausable,
    ERC721Permit,
    IPromissoryNote
{
    using Counters for Counters.Counter;

    // ============================================ STATE ==============================================

    // =================== Constants =====================

    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ============= Loan State ==============

    Counters.Counter private _tokenIdTracker;
    mapping(uint256 => uint256) public override loanIdByNoteId;

    // ========================================= CONSTRUCTOR ===========================================

    /**
     * @dev Creates the promissory note contract, granting minter, burner
     *      and pauser roles to the deployer address (which in practice
     *      will be LoanCore).
     *
     * @param name                  The name of the token (see ERC721).
     * @param symbol                The symbol of the token (see ERC721).
     */
    constructor(string memory name, string memory symbol) ERC721(name, symbol) ERC721Permit(name) {
        _setupRole(BURNER_ROLE, _msgSender());
        _setupRole(MINTER_ROLE, _msgSender());
        _setupRole(PAUSER_ROLE, _msgSender());

        // We don't want token IDs of 0
        _tokenIdTracker.increment();
    }

    // ======================================= TOKEN OPERATIONS =========================================

    /**
     * @notice Create a new token and assign it to a specified owner. The token ID
     *         should match the loan ID, and can only be called by the minter. Also
     *         updates the mapping to lookup loan IDs by note IDs.
     *
     * @dev See {ERC721-_mint}.
     *
     * @param to                    The owner of the minted token.
     * @param loanId                The ID of the token to mint, should match a loan.
     *
     * @return tokenId              The newly minted token ID.
     */
    function mint(address to, uint256 loanId) external override returns (uint256) {
        if (hasRole(MINTER_ROLE, _msgSender()) == false) revert PN_MintingRole(_msgSender());

        uint256 currentTokenId = _tokenIdTracker.current();
        _mint(to, currentTokenId);
        loanIdByNoteId[currentTokenId] = loanId;

        _tokenIdTracker.increment();

        return currentTokenId;
    }

    /**
     * @notice Create a new token and assign it to a specified owner. The token ID
     *         should match a loan ID, and can only be called by a burner - in practice
     *         LoanCore, which burns notes when a loan ends. Also unserts the mapping to
     *         lookup loan IDs by note IDs.
     *
     * @dev See {ERC721-_burn}.
     *
     * @param tokenId               The ID of the token to burn, should match a loan.
     */
    function burn(uint256 tokenId) external override {
        if (hasRole(BURNER_ROLE, _msgSender()) == false) revert PN_BurningRole(_msgSender());
        _burn(tokenId);
        loanIdByNoteId[tokenId] = 0;
    }

    // ===================================== ERC721 UTILITIES ===========================================

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlEnumerable, ERC721, ERC721Enumerable, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev Hook that is called before any token transfer.
     *      This notifies the promissory note about the ownership transfer.
     *
     * @dev Does not let tokens be transferred when contract is paused.
     *
     * @param from                  The previous owner of the token.
     * @param to                    The owner of the token after transfer.
     * @param tokenId               The token ID.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal virtual override(ERC721, ERC721Enumerable, ERC721Pausable) {
        super._beforeTokenTransfer(from, to, tokenId);

        if (paused() == true) revert PN_ContractPaused();
    }
}
