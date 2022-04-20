

# EIP-1822: UUPS (Universal Upgradeable Proxy Standard)
Developed in 2019, removes the need to inherit a proxy storage.\
To avoid storage collision, stores the contract logic on a specific storage slot which is predefined (vs. allowing Solidity to select the first storage slot for where the variables are defined in the contract layout).\
This can be done with ```sstore``` and ```sload``` where, in assembly, a variable can be stored to a specific storage slot and then loaded again from that slot.\
In the case of EIP-1822, ```keccak256("PROXIABLE") = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7"``` is used to specify the storage slot. It's not 100% random, but random enough so that there's no collision under normal circumstances.\
This comes from ```EIP-1967: Standard Storage Slots``` which is a standard for proxy slots so that block explorers can easily go into the proxy contract and extract the storage location of the logic contract implementation.

---

## ```DELEGATECALL``` Refresh:
A call where the code at the target address is executed in the context of the calling contract which invoked the ```DELEGATECALL```. Therefore ```msg.sender``` and ```msg.value``` of the original caller are preserved.\
When ```DELEGATECALL``` is used, the code at the target contract is executed, but the Storage, address and balance of the calling contract are used.

---

## Example using ```EIP-1822```:
```
//SPDX-License-Identifier: MIT

pragma solidity 0.8.1;

contract Proxy {
    // Code position in storage is keccak256("PROXIABLE") = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7"
    constructor(bytes memory constructData, address contractLogic) {
        // save the code address
        assembly { // solium-disable-line
            sstore(0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7, contractLogic)
        }
        (bool success, bytes memory result ) = contractLogic.delegatecall(constructData); // solium-disable-line
        require(success, "Construction failed");
    }

    fallback() external payable {
        assembly { // solium-disable-line
            let contractLogic := sload(0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7)
            calldatacopy(0x0, 0x0, calldatasize())
            let success := delegatecall(sub(gas(), 10000), contractLogic, 0x0, calldatasize(), 0, 0)
            let retSz := returndatasize()
            returndatacopy(0, 0, retSz)
            switch success
            case 0 {
                revert(0, retSz)
            }
            default {
                return(0, retSz)
            }
        }
    }
}

contract Proxiable {
    // Code position in storage is keccak256("PROXIABLE") = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7"

    function updateCodeAddress(address newAddress) internal {
        require(
            bytes32(0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7) == Proxiable(newAddress).proxiableUUID(),
            "Not compatible"
        );
        assembly { // solium-disable-line
            sstore(0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7, newAddress)
        }
    }

    function proxiableUUID() public pure returns (bytes32) {
        return 0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7;
    }
}

contract MyContract {

    address public owner;
    uint public myUint;

    function constructor1() public {
        require(owner == address(0), "Already initalized");
        owner = msg.sender;
    }

    function increment() public {
        //require(msg.sender == owner, "Only the owner can increment"); //someone forget to uncomment this
        myUint++;
    }
}

contract MyFinalContract is MyContract, Proxiable {

    function updateCode(address newCode) onlyOwner public {
        updateCodeAddress(newCode);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner is allowed to perform this action");
        _;
    }
}

```

---

## How to upgrade a contract:
1. deploy the new implementation contract
2. deploy the ```Proxiable``` contract
3. call ```updateCodeAddress(address newAddress)``` function in ```Proxiable```, passing the address of the new implementation contract
4. forget about the Implementation contract's address and treat the Proxy contract's address as the main address.


---

## Resources:
[Making an upgradeable smart contract](https://hackernoon.com/how-to-make-smart-contracts-upgradable-2612e771d5a2)\
[Upgrades and Proxy Patterns video](https://www.youtube.com/watch?v=YpEm9Ki0qLE&t=1558s)\
[Upgrade Smart Contracts](https://ethereum-blockchain-developer.com/110-upgrade-smart-contracts/08-eip-1822-uups/)

---

# Implementation w/ Openzeppelin
###
OpenZeppelin's [UpgradeableProxy](https://github.com/OpenZeppelin/openzeppelin-contracts/issues/2421#issuecomment-786034967) is an UUPS proxy.

1. install OZ upgradeable ```yarn add @openzeppelin/contracts-upgradeable```
2. add the upgrade mechanism to the implementation contract by inheriting ```UUPSUpgradeable ``` and an authorization function to define who should be allowed to upgrade the contract\
example:
```
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract MyTokenV1 is Initializable, ERC20Upgradeable, UUPSUpgradeable, OwnableUpgradeable {
    function initialize() initializer public {
      __ERC20_init("MyToken", "MTK");
      __Ownable_init();
      __UUPSUpgradeable_init();
```
3. to authorize the owner to upgrade the contract, implement ```_authorizeUpgrade```\
```function _authorizeUpgrade(address) internal override onlyOwner {}```
4. replace imports with ones that include the ```Upgradeable``` suffix
```
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
contract MyCollectible is ERC721Upgradeable {
```
5. replace constructors by internal initializer functions with naming convention ``` __{ContractName}_init```
6. define a public initializer function and call the parent initializer of the contract being extended
```
function initialize() initializer public {
        __ERC721_init("MyCollectible", "MCO");
     }
```
- do not leave an implementation contract uninitialized (an uninitialized implementation contract can be taken over by an attacker, which may impact the proxy)\
either invoke the initializer manually, or include a constructor to automatically mark it as initialized when it is deployed:
```
/// @custom:oz-upgrades-unsafe-allow constructor
constructor() initializer {}
```
- with [multiple inheritances](https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance), use ``` __{ContractName}_init_unchained``` to avoid double initialization of the same parent contracts
7. compile contract and deploy using ```deployProxy``` from the Upgrades Plugins\
(this function will first check for unsafe patterns, then deploy the implementation contract, and finally deploy a proxy connected to that implementation)
8. to deploy a UUPS proxy, manually specify that with the option ```kind: 'uups'```\
example: ```await upgrades.deployProxy(MyContractV1, { kind: 'uups' });```
9. to deploy a new version of the contract code and to upgrade the proxy, we can use ```upgrades.upgradeProxy``` (it's no longer necessary to specify kind: 'uups' since it is now inferred from the proxy address)\
```await upgrades.upgradeProxy(proxyAddress, MyTokenV2);```

### Avoid Using Initial Values in Field Declarations
Solidity allows defining initial values for fields when declaring them in a contract.\
This is equivalent to setting these values in the constructor, and as such, will not work for upgradeable contracts. Make sure that all initial values are set in an initializer function otherwise, any upgradeable instances will not have these fields set.

**DO NOT:**
```
contract MyContract {
    uint256 public hasInitialValue = 42; // equivalent to setting in the constructor
}
```

**DO THIS INSTEAD:**
```
contract MyContract is Initializable {
    uint256 public hasInitialValue;

    function initialize() public initializer {
        hasInitialValue = 42; // set initial value in initializer
    }
}
```

It is still ok to define constant state variables, because the compiler does not reserve a storage slot for these variables, and every occurrence is replaced by the respective constant expression.

**THIS IS OK:**
```
contract MyContract {
    uint256 public constant hasInitialValue = 42; // define as constant
}
```

### Note on Creating New Instances from Contract Code
New instance of a contract created from its code are handled directly by Solidity and not by OpenZeppelin Upgrades, which means that these contracts will not be upgradeable.\
The easiest way to achieve upgradeable instances is to accept an instance of that contract as a parameter, and inject it after creating it.


---

## Resources:
[OpenZeppelin UUPS Tutorial](https://forum.openzeppelin.com/t/uups-proxies-tutorial-solidity-javascript/7786)\
[Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable)

---

## Additional TODOs:
- create MultiSig for performing actual upgrade via OpenZeppelin
- contract to be EIP1967-compatible
- ```prepare_upgrade.js``` script needed to specify the Proxy Address
- re. network files: commit to [source control](https://docs.openzeppelin.com/upgrades-plugins/1.x/network-files) the files for all networks except the ones used in development\
the development version can be ignored:
```
// .gitignore
# OpenZeppelin
.openzeppelin/unknown-*.json
```