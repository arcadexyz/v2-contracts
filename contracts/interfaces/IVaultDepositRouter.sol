// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

interface IVaultDepositRouter {
    // ============= Events ==============

    event ERC20Deposit(address indexed vault, address indexed token, uint256 amount);
    event ERC721Deposit(address indexed vault, address indexed token, uint256 id);
    event ERC1155Deposit(address indexed vault, address indexed token, uint256 id, uint256 amount);

    // ============= Errors ==============

    error VDR_NotOwner(address vault, address caller);

    // ================ Deposit Operations ================

    function depositERC20(address vault, address token, uint256 amount) external;

    function depositERC721(address vault, address token, uint256 id) external;

    function depositERC1155(address vault, address token, uint256 id, uint256 amount) external;

    function depositPunk(address vault, address token, uint256 id) external;
}
