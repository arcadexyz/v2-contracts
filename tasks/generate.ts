import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { generateMnemonic } from 'bip39';
import { task } from 'hardhat/config';

task('generate', 'Create a mnemonic for deploying contracts to a public network', async (_, _hre) => {
  // generate mnumonic from bip39
  const mnemonic = generateMnemonic();
  // create wallet using ethers
  let hdDerivationPath = "m/44'/60'/1'/0/0";
  const wallet = ethers.Wallet.fromMnemonic(mnemonic, hdDerivationPath);
  // write mnemonic and address to the generated folder
  const generatedFolderPath = path.join(__dirname, "../", "generated");
  try {
    fs.writeFileSync(path.join(generatedFolderPath, `${wallet.address}.txt`), mnemonic.toString());
    console.log("Mnemonic for address (" + `${wallet.address}` + ") saved to the 'generated' folder")
  } catch (error) {
    fs.mkdirSync(generatedFolderPath);
    fs.writeFileSync(path.join(generatedFolderPath, `${wallet.address}.txt`), mnemonic.toString());
    console.log("Mnemonic for address(" + `${wallet.address}` + ") saved to the 'generated' folder")
  }
});
