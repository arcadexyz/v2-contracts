// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "../libraries/LoanLibrary.sol";

/**
 * @title LendingUtilsErrors
 * @author Non-Fungible Technologies, Inc.
 *
 * This file contains custom errors for utilities used by the lending protocol contracts.
 * Errors are prefixed by the contract that throws them (e.g., "PR_" for PunkRouter).
 */

// ==================================== ERC721 Permit ======================================
/// @notice All errors prefixed with ERC721P_, to separate from other contracts in the protocol.

/**
 * @notice Deadline for the permit has expired.
 *
 * @param deadline                      Permit deadline parameter as a timestamp.
 */
error ERC721P_DeadlineExpired(uint256 deadline);

/**
 * @notice Address of the owner to also be the owner of the tokenId.
 *
 * @param owner                        Owner parameter for the function call.
 */
error ERC721P_NotTokenOwner(address owner);

/**
 * @notice Invalid signature.
 *
 * @param signer                        Signer recovered from ECDSA sugnature hash.
 */
error ERC721P_InvalidSignature(address signer);

// ==================================== Punk Router ======================================
/// @notice All errors prefixed with PR_, to separate from other contracts in the protocol.

/**
 * @notice Not the owner of the specified punkIndex.
 *
 * @param caller                        Msg.sender of the function call.
 */
error PR_NotOwner(address caller);
