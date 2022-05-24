# Deploying with hardhat-deploy

## View Wallet
See your network balances. Send funds to the wallet with the QR code.
```
npx hardhat account
```

## Generate Wallet
EOA info added to 'generated' folder.
```
npx hardhat generate
```

## Deploy Commands
Localhost deployments use the hardhat deployer account. Otherwise, the most recently generated wallet will be used for all other networks. Make sure it is funded.

To import a wallet, create a file called <address>.txt in the 'generated' folder and inside the file paste the mnemonic or private key. Similarly create a file in the same folder called mnemonic.txt and past in the same mnemonic or private key you used in the last file.
```
npx hardhat deploy --tags <tag name>
npx hardhat deploy --tags <tag name> --reset
```
