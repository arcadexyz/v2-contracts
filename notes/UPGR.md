# Upgradability, why?
Modify contract code while preserving the contract address, state and balance.
Helpful as a safeguard for implementing a fix in the event of a vulnerability, or as a means to progressively add new features.

# How does it work?
The user interacts with the implementation contract via a proxy contract.
The proxy contract is able to store the address of the implementation contract.
An upgrade is incorporated by deploying a new version of the implementation contract and updating that contract's info in the proxy contract.

Most Proxy patterns use the **Transaprent Proxy** and **UUPS** (universal upgradeable proxy standard) patterns.

# Transparent vs. UUPS Proxy
## Transparent Proxy Pattern:
- all logic related to upgrades is contained in the proxy and the implementation contract does not need any special logic to act as a delegation target
- subject to vulnerability caused by function selector clashes (implementation contract can have a function that has the same 4-byte identifier as the proxy’s upgrade function)
- expensive deployment: each call requires an additional read from storage to load the admin address and the contract itself is expensive to deploy at over 700k gas

## UUPS Proxy Pattern:
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

# Surface Level How To
Whenever you deploy a new contract using OpenZeppelin's ```deployProxy```, that contract instance can be upgraded at a later date. By default, only the address that originally deployed the contract has the ability to upgrade it.\
```deployProxy``` generates these transactions:
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


# References on Upgradeability
1. [OpenZeppelin docs](https://docs.openzeppelin.com/learn/upgrading-smart-contracts)
2. [The State of Smart Contract Upgrades](https://blog.openzeppelin.com/the-state-of-smart-contract-upgrades/)
3. [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable)
4. [OpenZeppelin tutorial](https://forum.openzeppelin.com/t/openzeppelin-upgrades-step-by-step-tutorial-for-hardhat/3580)


### TODO:
- Look at current architecture
- Decide - which contracts should be upgradeable?
- Decide - which dependencies need to get passed in constructors for each contract?
- Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and/or only changeable by upgrade?
immutable, can be changed by admin, only changeable via upgrade
- Decide what upgradebility pattern should be used?