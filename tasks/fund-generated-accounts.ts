import fs from 'fs';
import "@nomiclabs/hardhat-ethers";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { mnemonicToSeed, generateMnemonic } from 'bip39';
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
import { task } from 'hardhat/config';

dotenvConfig({ path: resolve(__dirname, "../.env") });

// deployer mnemonic from .env
let mnemonic: string;
if(process.env.MNEMONIC) {
    mnemonic = process.env.MNEMONIC;
} else {
    throw new Error("ADDRESS environment variable is not set.")
}

const generatedFolder = './generated/';
const childAddress:string[] = [];

task('fundGeneratedAccounts', 'Adds 0.1 ETH to each of the wallets in the generated folder.')
.addParam("networkName", "Name of network you want to deploy to").addParam("amount", "Enter the amount you want to send in ETH")
.setAction( async (taskArgs, hre) => {
  // get file names
  fs.readdirSync(generatedFolder).forEach(file => {
      // slice .txt from end of filename string
      let addr = file.split(".txt")[0]
      // add to local array
      childAddress.push(addr);
  });

  // send transactions
  const network = hre.network;
  const provider = new hre.ethers.providers.AlchemyProvider(network.name)
  let wallet = hre.ethers.Wallet.fromMnemonic(mnemonic);
  let signer = wallet.connect(provider);
  let gas = await provider.getGasPrice()
  let beginningNonce = await hre.ethers.provider.getTransactionCount(wallet.address)

  // send one transfer tx to every wallet in the array
  for(let i = 0; i < childAddress.length; i++) {
      const tx = {
          from: wallet.address,
          to: childAddress[i],
          value: hre.ethers.utils.parseEther(taskArgs.amount),
          nonce: beginningNonce + i,
          gasLimit: hre.ethers.utils.hexlify(500000),
          gasPrice: gas.toNumber(),
      }

      await signer.sendTransaction(tx)
      .then((transaction) => {
          console.log("/ / / / / /")
          console.log("Tx #" + (i+1) + ": Sent to "+ childAddress[i] + ", has finished!")
      })
  }
});
