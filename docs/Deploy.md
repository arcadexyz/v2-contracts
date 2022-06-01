# Deploying with hardhat-deploy

## View Wallet
See your network balances. Send funds to the wallet with the QR code.
```
yarn account
```

## Generate Wallet
EOA info added to 'generated' folder.
```
yarn generate
```

## Deploy Commands
Localhost deployments use the hardhat deployer account. Otherwise, the most recently generated wallet will be used for all other networks. Make sure it is funded.

To import a wallet, create a file called <address>.txt in the 'generated' folder and inside the file paste the mnemonic or private key. Similarly create a file in the same folder called mnemonic.txt and past in the same mnemonic or private key you used in the last file.

Possible deployment tags: Protocol, VaultFactory, PunkRouter
```
yarn typechain

npx hardhat deploy --network <networkName> --tags <tag name>
// or
npx hardhat deploy --network <networkName> --tags <tag name> --reset
```

## Verify Deployed Contracts
Contracts can be verified on Tenderly, Etherscan, or both.
```
// all contracts on tenderly
npx hardhat --network <networkName> tenderly:verify

// specific contract addresses
// Contract with no constructor arguments
npx hardhat verify <contractAddress>  --network <networkName>
// Contract with constructor args or a ERC1967Proxy
npx hardhat verify <proxyContractAddress> --network <networkName> "<arg1>" "<arg2>"

```

## Grant Roles
Using the deployer wallet, run the grant-roles script with the new contract addresses to grant the proper roles to the various contracts. Then transfer admin ownership to the multi-sig
```
npx hardhat run grant-roles
```
