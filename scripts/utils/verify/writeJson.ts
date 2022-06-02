const fs = require('fs');
import hre, { ethers, upgrades } from "hardhat";

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

// const hello = main("0x3A54241cB7801BDea625565AAcb0e873e79C0649",
//                 "0xdeaBbBe620EDF275F06E75E8fab18183389d606F",
//                 "0x0888774c51841a994899EcF67E65DC30D707376A",
//                 "0xd624D1879429A606f54F48B08b56126c3Fe70049",
//                 "0x7BB0A098BcA96200fbe19ee54dDBdD52d86df423",
//                 "0x0A5eCAC03ACB40206AbBB8E7238AAf491375923C",
//                 "0x9D4cdaB126793AA53847e029b9f6d5d89Ca761a8",
//                 "0x26a998ae4F36306C8Ec5d06f99a7AB5FF52847B4",
//                 "0xeDeD1436c45b6C2e55D1d09F07a725fd38C37077")
// console.log(hello)



//.........................   "VaultFactory": "0xE4a1917Ebe8fd2CAFD79799C82aDAa7E81AC6D47", vaultFacroryImpl: 0x070c58d8720b18A5763c1e24FE30d6AA77F86810,  vaultFactProxy: 0x0a7decEd17B4239D2E90ad2cc74411bbE442bED8

//.........................   "LoanCore": "0x23ce21bE3ebd1c86325100460D58d14a1D143E8d", 0x581Ab2f39524538c0dEDccFe4b7164B1A023CE09, proxy: 0x761163b497ebd35ABA78978203D767b74D6Bc067

//.........................   "OriginationController": "0xFE046149bc8830d989A007E81A9D7F8A3b575F36", 0x142D0B78EADD7cd07eAdAF334a442A2a38fa1c66, proxy: 0xaA9B7AC3180Ec6735dCf1d03eF5cA011E2c30EA0

//   "CallWhitelist": "0x0A5eCAC03ACB40206AbBB8E7238AAf491375923C",

//   "AssetVault": "0x3A54241cB7801BDea625565AAcb0e873e79C0649",

//   "FeeController" "0xdeaBbBe620EDF275F06E75E8fab18183389d606F",

//   "BorrowerNote": "0x0888774c51841a994899EcF67E65DC30D707376A",

//   "LenderNote":  "0xd624D1879429A606f54F48B08b56126c3Fe70049",

//   "RepaymentController": "0x7BB0A098BcA96200fbe19ee54dDBdD52d86df423",

