# Upgradability, why?
Modify contract code while preserving the contract address, state and balance.

# How does it work?
The user interacts with the implementation contract via a proxy contract.
The proxy contract is able to store the address of the implementation contract.
An upgrade is incorporated by deploying a new version of the implementation contract and updating that contract's info in the proxy contract.

Most Proxy patterns use the **Transaprent Proxy** and **UUPS** (universal upgradeable proxy standard) patterns.

# Transparent vs. UUPS Proxy
## Transparent Proxy Pattern:
- upgrade handled by proxy contract
- deployment more expensive
- easy to maintain

## UUPS Proxy Pattern:
- upgrade handled by the implementation contract
- deployment is cheaper
- more challenging maintenance

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

    for UUPS:\
```contract MyContract is initializable, UUPSUpgradable {}```
3. replace the constructor with initialize ```function initialize() public initializer {}```
4. change all OpenZeppelin contract libraries to their upgradable versions\
    example: ```Ownable``` becomes ```OwnableUpgradeable```

5. call the ```_init``` functions of the upgradable contracts in the initialize function\
    example:
    ```
    function initialize() initializer public {
        __ERC1155_init(“”);
        __Ownable_init();
        __UUPSUpgradeable_init();
        }
    ```
6. replace ```msg.sender``` with ```_msgSender()``` to work with users' wallet addresses instead of with proxy addresses

7. create a script to deploy the contract as an upgardeable contract using ```deployProxy```\
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

# Storage Collision Warning
Any new variables that need to be added to the upgraded version of the implementation contract need to be added in the code, below the other variables (not on top or between), to avoid storage collision.

## TODO:
- Look at current architecture
- Decide - which contracts should be upgradeable? What upgradebility pattern should they use?
- Decide - which dependencies need to get passed in constructors for each contract?
- Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and/or only changeable by upgrade?

## References:
[OpenZeppelin docs](https://docs.openzeppelin.com/learn/upgrading-smart-contracts)\
[OpenZeppelin blog](https://blog.openzeppelin.com/the-state-of-smart-contract-upgrades/)\
[OpenZeppelin tutorial](https://forum.openzeppelin.com/t/uups-proxies-tutorial-solidity-javascript/7786)