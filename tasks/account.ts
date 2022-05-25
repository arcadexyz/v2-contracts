import { task } from 'hardhat/config';
import config  from '../hardhat.config';
import { HttpNetworkUserConfig } from 'hardhat/types';
import { getAccountData } from './functions/accounts';
import { getMnemonic } from './functions/mnemonic';
import * as qrcode from 'qrcode-terminal';

task('account', 'Get balance informations for the deployment account.', async (_, hre) => {
  // get the current deployer from the mnemonic file
  const { address } = await getAccountData(getMnemonic());
  // display QR for deployer account
  qrcode.generate(address);
  console.log(`‍🔶 Deployer Account is ${address} ‍🔶 `);
  // print balances on every network except localhost
  for (const n in config.networks) {
    // omit localhost/ hardhat from the balances. To include, a local hardhat node must be running
    if(n != "localhost" && n != "hardhat") {
      try {
        const { url } = config.networks[n] as HttpNetworkUserConfig;
        const provider = new hre.ethers.providers.JsonRpcProvider(url);
        const balance = await provider.getBalance(address);
        console.log(` -- ${n} --  -- -- -- `);
        console.log(`   balance: ${hre.ethers.utils.formatEther(balance)}`);
        console.log(`   nonce: ${await provider.getTransactionCount(address)}`);
      } catch (e) {
        console.log(e);
      }
    }
  }
});
