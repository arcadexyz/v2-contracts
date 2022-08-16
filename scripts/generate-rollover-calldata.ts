/* eslint no-unused-vars: 0 */

import fs from 'fs';
import hre, { ethers } from "hardhat";

import { FlashRolloverV1toV2 } from "../typechain";

export async function main(): Promise<void> {
    const payloadStr = fs.readFileSync('./rollover_payload.json', 'utf-8');
    const payload = JSON.parse(payloadStr);

    const frFactory = await ethers.getContractFactory("FlashRolloverV1toV2");
    const fr = await frFactory.attach("0x07352eD030C6fd8d12f8258d2DF6f99Cba533dC9");

    // const terms = payload.newLoanTerms;
    // const vaultId = ethers.BigNumber.from(terms.collateralId);
    // terms.collateralId = vaultId;

    const calldata = fr.interface.encodeFunctionData('rolloverLoan', [
        payload.contracts,
        payload.loanId,
        payload.newLoanTerms,
        payload.lender,
        payload.nonce,
        payload.signature.v,
        payload.signature.r,
        payload.signature.s
    ]);

    console.log("\nEncoded calldata:")
    console.log(calldata);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}