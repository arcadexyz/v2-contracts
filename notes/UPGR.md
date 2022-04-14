# Upgradability, why?
Modify contract code while preserving the contract address, state and balance.
Helpful as a safeguard for implementing a fix in the event of a vulnerability, or as a means to progressively add new features.

# How does it work?
The user interacts with the implementation contract via a proxy contract.
The proxy contract is able to store the address of the implementation contract.
An upgrade is incorporated by deploying a new version of the implementation contract and updating that contract's info in the proxy contract. In [detail](https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies?utm_source=zos&utm_medium=blog&utm_campaign=proxy-pattern#summary).

Most Proxy patterns use the **Transaprent Proxy** and **UUPS** (universal upgradeable proxy standard) patterns.

# Transparent vs. UUPS Proxy
## Transparent Proxy Pattern:
- all logic related to upgrades is contained in the proxy and the implementation contract does not need any special logic to act as a delegation target
- subject to vulnerability caused by function selector clashes (implementation contract can have a function that has the same 4-byte identifier as the proxy’s upgrade function)
- expensive deployment: each call requires an additional read from storage to load the admin address and the contract itself is expensive to deploy at over 700k gas

## [Universal Upgradeable Proxy Standard](https://eips.ethereum.org/EIPS/eip-1822) or UUPS:
- upgrade logic is placed in the implementation contract
- all implementation contracts to extend from a base **proxiable** contract
- since all functions are defined in the implementation contract, the Solidity compiler checks for function selector clashes
- cheaper deployment: smaller in size and requires one less read from storage with every call
- if the proxy is upgraded to an implementation that fails to implement the upgradeable functions, it becomes permanently locked into that implementation
- proxy storage clash issues have been resolved with the **unstructured storage pattern** which adds a level of complexity to the proxy implementation


### UUPS Storage Layout Compatibility - SPECIAL CARE NEEDED:
Solidity maps variables to a contract's storage based on the order in which the variables are declared. Reordering variables, inserting new ones, changing their types or even changing the inheritance chain of a contract can break storgage.
To ensure storage remains compatible across upgrades, best practice is to use **append-only** storage contracts by declaring storage in a separate contract which is only modified to append new variables and never delete. The implemenation contract would extend from this storage contract.
All contracts in the inheritance chain must follow this pattern to prevent mixups including contracts from external libraries.
We can reserve space for future state variables in the base contract by declaring dummy variables.\
OR\
Use the eternal storage pattern where the implementation contract never declares any variables of its own, but stores them in a mapping, causing Solidity to save them in arbitrary positions of storage based on their assigned names.

**IMPORTANT note: it is possible to be inadvertently changing the storage variables of your contract by [changing its parent contracts](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#modifying-your-contracts). Also pay attention to the workaround at the bottom of linked page.**


# Sample UUPS Projects
- Compound uses an append only storage contract to mitigate storage clashes for changes to their (Comptroller Contract)[https://github.com/compound-finance/compound-protocol/blob/v2.8.1/contracts/ComptrollerStorage.sol#L97].
- The upgrade-safe fork of OpenZeppelin Contracts uses a pattern where they “reserve” space for future space variables in the base contract by declaring dummy variables.
- There is a pattern called Eternal Storage Pattern where all implementation contract variables are not declared, instead they are stored in mappings which causes Solidity to save them in arbitrary positions of storage, so the risk of collision is very minimal.
Polymath uses this pattern for their (protocol)[https://github.com/PolymathNetwork/polymath-core/blob/v3.0.0/contracts/datastore/DataStoreStorage.sol#L1].

# Diamond Pattern
This pattern allows for fine very grained upgrades and their deployments.
The pattern stores within it a mapping of function selectors to contract addresses.
Rather than upgrade and deploy a full contract, for example, a singular function can be upgraded and deployed independently.  Its selector would replace that of its older version in the mapping and it would be called by the contract as it had been before.
This would save lots of deployment eth.
The main issue with this pattern is that it’s not supported in ‘hardhat-upgrades’.
For other upgradeability patterns, ‘hardhat-upgrades’ builds the proxy and implementation system for the upgrade during deployment.
This is not available for the Diamond pattern and would need to be custom built.
## Issues:
Mark Toda categorically against using the Diamond: "Generally think diamond pattern makes it really hard to reason about the logic of your contracts, and really easy to mess up an upgrade. Here's a pretty good [article](https://blog.trailofbits.com/2020/10/30/good-idea-bad-design-how-the-diamond-standard-falls-short/) by trail of bits on it."
## Diamond Pattern References:
[Solidity developer](https://soliditydeveloper.com/eip-2535)

[Diamond EIP](https://eips.ethereum.org/EIPS/eip-2535)

# Surface Level How To
Whenever you deploy a new contract using OpenZeppelin's ```deployProxy```, that contract instance can be upgraded at a later date. By default, only the address that originally deployed the contract has the ability to upgrade it.\
```deployProxy``` deploys the implementation contract, a ProxyAdmin to be the admin for project proxies and the proxy, along with calling any initialization. 3 transactions are generated:
- deploy txn of the implementation contract
- deploy txn of the ```ProxyAdmin``` contract which is the admin of the proxy
- deploy txn of the proxy contract and running the initializer functions

## Basic implementation:
1. configure Hardhat to use ```@openzeppelin/hardhat-upgrades```
2. inherit the initializable contract\
```contract MyContract is initializable {}```
3. replace the constructor with initialize ```function initialize() public initializer {}```
4. avoid intial values in field declarations, place these values in the initializer function (it is ok to define constant state variables because the compiler does not reserve storage slots for these)
5. use the upgradeable OpenZeppelin contract libraries\
    example: ```Ownable``` becomes ```OwnableUpgradeable```

6. call the ```_init``` functions of the upgradable contracts in the initialize function\
    example:
    ```
    function initialize() initializer public {
        __ERC1155_init(“”);
        __Ownable_init();
        __UUPSUpgradeable_init();
        }
    ```
7. replace ```msg.sender``` with ```_msgSender()``` to work with users' wallet addresses instead of with proxy addresses

8. create a script to deploy the contract as an upgardeable contract using ```deployProxy```\
    example:
    ```
    async function main() {
        const MyContract = await ethers.getContractFactory('MyContract');
        console.log('Deploying MyContract...');
        const mycontract = await upgrades.deployProxy(MyContract, { initializer: '...' });
        await mycontract.deployed();
        console.log('MyContract deployed to:', mycontract.address);
        }

    main();
    ```
Note:
- This is where we take note of the deployed proxy address for later use.
- Only the owner of the ProxyAdmin can upgarde the proxy.
- Multi-sig needed to perform an upgrade. Proxy address is used in this step along with address of new implementation.
- Can be done on Gnosis Safe OpenZeppelin app
- Implementation contract should be EIP1967-compatible
- Proxy address is used to interact with an upgraded version of a smart contract


## Technical Limitations of Upgrades
When we upgrade a smart contract to a new version we cannot change the storage layout of that contract.\
Already declared state variables cannot be removed or have their type changed, or have new variables declared before them.\
This limitation only affects state variables. Functions and events can be changed as needed.

# v2 Contracts to be Made Upgradable
Does this get implemented automatically: [```_init_unchained``` for Multiple Inheritance](https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance) ?
### AssetWrapper.sol
- dependencies to be passed in initializer function:
    1. __ERC721_init('NftName', 'SYM')
    2. __ERC721Permit_init('')
- ERC721 to be immutable, ERC721Permit to also be immutable

### FeeController.sol
- as per contract comments, new verison of contract to allow fees to be modified / added based on user attributes
- dependencies to be passed in initializer function not yet incorporated
- to be changed only by an admin

### LoanCore.sol
- dependencies to be passed in initializer function:
    1. __IERC721_init()
    2. __IFeeController_init()
- IERC721 to be immutable, IFeeController to be upgradeable

### PromissoryNote.sol
- dependencies to be passed in initializer function:
    1. __ERC721_init('NftName', 'SYM')
    2. __ERC721Permit_init('')
- ERC721 to be immutable, ERC721Permit to also be immutable


# References on Upgradeability
1. [OpenZeppelin docs](https://docs.openzeppelin.com/learn/upgrading-smart-contracts)
2. [The State of Smart Contract Upgrades](https://blog.openzeppelin.com/the-state-of-smart-contract-upgrades/)
3. [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable)
4. [OpenZeppelin tutorial](https://forum.openzeppelin.com/t/openzeppelin-upgrades-step-by-step-tutorial-for-hardhat/3580)



# Clash Detection Plugins
## [Slither](https://github.com/crytic/slither)
Open source static analysis framework for Solidity written in Python 3.\
It runs a suite of vulnerability detectors, prints visual info about contract details and provides an API to easily write custom analyses.\
It enables developers to easily find vulnerabilities, enhance code comprehension and quickly prototype custom analyses.
Automated vulenrability detection, Automated optimization detection.

Sample [list of vulnerabilities](https://github.com/crytic/slither/blob/master/trophies.md) found by Slither.
### Select features:
- Detects vulnerabilities with low false positives
- Identifies the location of the error in the source code
- Easily integrates with CI and framework builds
- Detector API available for writing custom analysis in Python
- Average execution time < 1 second per contract
- Ability to analyze contracts written with Solidity >= 0.4
### How it works:
- Takes Solidity Abstract Syntax Tree (AST) generated by the Solidity compiler as the initial input
- Generates info such as contract inheritance graph, the control flow graph (CFG) and the list of expressions in the contract
-  Translates the contract code into SlithIR (Slither internal representation language)
- Runs set of pre-defined analyses that provide enhanced info to other modules
### Note:
- It requires Python and solc
- Can be [integrated](https://github.com/marketplace/actions/slither-action) with GitHub action

## [Openzeppelin Upgrades Plugin](https://docs.openzeppelin.com/upgrades-plugins/1.x/)
Plugin to deploy and manage upgradeable contracts.\
If a contract's storage layout is accidentally messed up, the Upgrades Plugin will emit a warning when the upgarde is being implemented.

### Features:
- Deployment of upgradeable smart contracts
- Upgrade of deployed contracts
- Proxy admin rights management
- Ease of use in tests

### Network Files:
OZ Upgrades keeps track of all the contract versions that have been deployed in a ```.openzeppelin``` folder in the project root, as well as the proxy admin.
The following info is tracked:
- ```types```: keeps track of all the types used in the contract or its ancestors, from basic types like uint256 to custom struct types
- ```storage```: tracks the storage layout of the linearized contract, referencing the types defined in the types section, and is used for verifying that any storage layout changes between subsequent versions are compatible


**Note:** While this plugin keeps track of all the implementation contracts we deploy per network, in order to reuse them and validate storage compatibilities, it does not keep track of the proxies that have been deployed. This means that we will need to manually keep track of each proxy deployment address, to supply those to the upgrade function when needed.

### OZ Upgrades Plugin References:
[Step by step tutorial for upgrade using OZ Upgrades Plugin and Hardhat](https://forum.openzeppelin.com/t/openzeppelin-upgrades-step-by-step-tutorial-for-hardhat/3580)
