const fs = require('fs');
import hre from "hardhat";

import { main as writeInfo } from "./writeInfo";
import { contractInfo } from "./writeInfo";
import { contractData, PromissoryNoteTypeBn, PromissoryNoteTypeLn } from "../../deploy/deploy";
import { SECTION_SEPARATOR } from "../bootstrap-tools";

export interface deploymentData {
    [contractName: string]: contractData | PromissoryNoteTypeBn | PromissoryNoteTypeLn
}

//let contractInfo;
export async function main(
    assetVaultAddress: string,
    feeControllerAddress: string,
    borrowerNoteAddress: string,
    lenderNoteAddress: string,
    repaymentContAddress: string,
    whitelistAddress: string,
    vaultFactoryAddress: string,
    loanCoreAddress: string,
    originationContAddress: string
  ): Promise<void> {
            const timestamp = new Date().getTime() * 1000
            const networkName = hre.network.name
            const deploymentsFolder = `./.deployments/`
            const jsonFile = `${networkName}-${timestamp}.json`

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
                originationContAddress
            )

            fs.writeFileSync(
            deploymentsFolder  + `${networkName}/` + jsonFile,
            JSON.stringify(
                contractInfo,
                undefined,
                2
                )
            );

            console.log(SECTION_SEPARATOR);
            console.log("Contract info written to: ", `${networkName} ${timestamp}`);

  }


