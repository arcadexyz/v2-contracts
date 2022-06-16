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
});
