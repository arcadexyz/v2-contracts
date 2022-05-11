// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

interface IRepaymentController {
    function repay(uint256 borrowerNoteId) external;

    function claim(uint256 lenderNoteId) external;

    function getInstallmentMinPayment(uint256 borrowerNoteId)
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        );

    function repayPartMinimum(uint256 borrowerNoteId) external;

    function repayPart(uint256 borrowerNoteId, uint256 amount) external;

    function closeLoan(uint256 borrowerNoteId) external;

    function amountToCloseLoan(uint256 borrowerNoteId) external returns (uint256, uint256);
}
