<<<<<<< HEAD
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
=======
import fs from 'fs';
import { ethers } from "ethers";
import { mnemonicToSeed, generateMnemonic } from 'bip39';
import { task } from 'hardhat/config';

const mnemonicPath = "../generated";

task('generate', 'Create a mnemonic for deploys or testing', async (_, _hre) => {
  const mnemonic = generateMnemonic();
  console.log('Generated Mnemonic: ', mnemonic);
  const seed = await mnemonicToSeed(mnemonic);
  const wallet = new ethers.Wallet(seed);
  console.log('An Associated Address: ', wallet.address);

  fs.writeFileSync(`./generated/${wallet.address}.txt`, mnemonic.toString());
  fs.writeFileSync(mnemonicPath, mnemonic.toString());
>>>>>>> 3d8a8ef (generate and fund child wallet scripts done)
});
