// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IWrappedPunks is IERC721 {
    function mint(uint256 punkIndex) external;
    function burn(uint256 punkIndex) external;
    function registerProxy() external;
    function proxyInfo(address user) external returns (address proxy);
}
