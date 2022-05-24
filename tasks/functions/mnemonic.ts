import fs from 'fs';

export const mnemonicPath = 'generated/mnemonic.txt';

export const getMnemonic = (): string => {
  try {
    return fs.readFileSync(mnemonicPath).toString().trim();
  } catch (e) {
    if (process.env.HARDHAT_TARGET_NETWORK !== 'localhost') {
      console.log('⚠️ WARNING: No mnemonic file created for a deploy account. Try `npx hardhat generate` and then `npx hardhat account`.');
    }
  }
  return '';
};
