// SPDX-License-Identifier: MIT

pragma solidity ^0.8.11;

interface IVaultInventoryReporter {
    // ============= Events ==============

    event Registered(address indexed vault, address indexed reporter, bytes32 itemsHash);

    // ============= Data Types ==============

    enum ItemType {
        ERC_721,
        ERC_1155,
        ERC_20
    }

    struct Item {
        ItemType itemType;
        address tokenAddress;
        uint256 tokenId;                // Not used for ERC20 items - will be ignored
        uint256 tokenAmount;            // Not used for ERC721 items - will be ignored
    }

    // ================ Inventory Operations ================

    function add(address vault, Item[] calldata items) external;

    function remove(address vault, Item[] calldata items) external;

    function clear(address vault) external;

    // ================ Verification ================

    function verify(address vault) external view returns (bool);

    function verifyItem(address vault, Item calldata item) external view returns (bool);

    // ================ Enumeration ================

    function enumerate(address vault) external view returns (Item[] memory);

    function keys(address vault) external view returns (bytes32[] memory);

    function keyAtIndex(address vault, uint256 index) external view returns (bytes32);

    function itemAtIndex(address vault, uint256 index) external view returns (Item memory);
}
