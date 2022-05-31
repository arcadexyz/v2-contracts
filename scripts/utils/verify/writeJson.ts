const fs = require('fs');
import hre from "hardhat";

import { contractData, PromissoryNoteTypeBn, PromissoryNoteTypeLn } from "../../deploy/deploy";
import { SECTION_SEPARATOR } from "../bootstrap-tools";

export interface deploymentData {
    [contractName: string]: contractData | PromissoryNoteTypeBn | PromissoryNoteTypeLn
}

//let contractInfo;
export async function main(
  contractInfo : deploymentData
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

            fs.writeFileSync(
            deploymentsFolder  + `${networkName}/` + jsonFile,
            JSON.stringify(
                contractInfo,
                undefined,
                2
                )
            );

            console.log("Contract info written to: ", `${networkName} ${timestamp}`);

            console.log(SECTION_SEPARATOR);
  }

// // We recommend this pattern to be able to use async/await everywhere
// // and properly handle errors.
// if (require.main === module) {
//     main(contractInfo)
//         .then(() => process.exit(0))
//         .catch((error: Error) => {
//             console.error(error);
//             process.exit(1);
//         });
// }