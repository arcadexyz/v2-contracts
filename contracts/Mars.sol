// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract Mars is Initializable, ERC20Upgradeable, UUPSUpgradeable, OwnableUpgradeable {
    uint256 public initialValue;

    function initialize() initializer public {
      __ERC20_init("Mars", "MARS");
      __Ownable_init();
      __UUPSUpgradeable_init();

      _mint(msg.sender, 10000000 * 10 ** decimals());

       initialValue = 12;

    }

    function updateValue() public virtual returns(uint) {
       uint updatedVal = initialValue + 8;
       initialValue = updatedVal;
       return updatedVal;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() initializer {}

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

contract MarsV2 is Mars {
    function version() pure public returns (string memory) {
        return "V2!";
    }

    function updateValue() public override returns(uint) {
       uint updatedVal = initialValue * 2;
       initialValue = updatedVal;
       return updatedVal;
    }
}