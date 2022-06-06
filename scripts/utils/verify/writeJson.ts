const fs = require("fs");
import hre from "hardhat";

import { main as writeInfo } from "./writeInfo";
import { contractInfo } from "./writeInfo";
import { contractData, PromissoryNoteTypeBn, PromissoryNoteTypeLn } from "../../deploy/deploy";

export interface deploymentData {
    [contractName: string]: contractData | PromissoryNoteTypeBn | PromissoryNoteTypeLn;
}

export async function main(
    assetVaultAddress: string,
    feeControllerAddress: string,
    borrowerNoteAddress: string,
    lenderNoteAddress: string,
    repaymentContAddress: string,
    whitelistAddress: string,
    vaultFactoryAddress: string,
    loanCoreAddress: string,
    originationContAddress: string,
    bNoteName: string,
    bNoteSymbol: string,
    lNoteName: string,
    lNoteSymbol: string,
): Promise<void> {
    const timestamp = new Date().getTime() * 1000;
    const networkName = hre.network.name;
    const deploymentsFolder = `./.deployments/`;
    const jsonFile = `${networkName}-${timestamp}.json`;

    if (!fs.existsSync(deploymentsFolder)) {
        fs.mkdirSync(deploymentsFolder);
    }

    if (!fs.existsSync(deploymentsFolder + `${networkName}`)) {
        fs.mkdirSync(deploymentsFolder + `${networkName}`);
    }

    await writeInfo(
        assetVaultAddress,
        feeControllerAddress,
        borrowerNoteAddress,
        lenderNoteAddress,
        repaymentContAddress,
        whitelistAddress,
        vaultFactoryAddress,
        loanCoreAddress,
        originationContAddress,
        bNoteName,
        bNoteSymbol,
        lNoteName,
        lNoteSymbol,
    );

    fs.writeFileSync(deploymentsFolder + `${networkName}/` + jsonFile, JSON.stringify(contractInfo, undefined, 2));

    console.log("Contract info written to: ", `${networkName} ${timestamp}`);
}
