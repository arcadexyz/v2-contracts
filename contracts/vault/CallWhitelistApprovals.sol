// SPDX-License-Identifier: GPL-3.0-only

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./CallWhitelist.sol";
import "../interfaces/IERC721Permit.sol";

/**
 * @title CallWhitelistWithApprovals
 * @author Non-Fungible Technologies, Inc.
 *
 * Adds approvals functionality to CallWhitelist. Certain spenders
 * can be approved for tokens on vaults, with the requisite ability
 * to withdraw. Should not be used for tokens acting as collateral.
 *
 * The contract owner can add or remove approved token/spender pairs.
 */
contract CallWhitelistApprovals is CallWhitelist {
    event ApprovalSet(address indexed caller, address indexed token, address indexed spender, bool isApproved);

    // ============================================ STATE ==============================================

    // ================= Whitelist State ==================

    mapping(address => mapping(address => bool)) private approvals;

    function isApproved(address token, address spender) public view returns (bool) {
        return approvals[token][spender];
    }

    // ======================================== UPDATE OPERATIONS =======================================

    function setApproval(address token, address spender, bool _isApproved) external onlyOwner {
        approvals[token][spender] = _isApproved;
        emit ApprovalSet(msg.sender, token, spender, _isApproved);
    }
}
