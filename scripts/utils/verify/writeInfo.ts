import { upgrades } from "hardhat";


import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../bootstrap-tools";

import { deploymentData, PromissoryNoteTypeBn, PromissoryNoteTypeLn } from "../../deploy/deploy";

export let contractInfo: deploymentData = {}
export async function main (
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
    contractInfo["CallWhitelist"] = {
        "contractAddress": whitelistAddress,

        "constructorArgs": []
    };

    console.log("Whitelist contract info written.");
    console.log(SUBSECTION_SEPARATOR);

     contractInfo["AssetVault"] = {
        "contractAddress": assetVaultAddress,

        "constructorArgs": []
    };

    console.log("Asset vault contract info written.");
    console.log(SUBSECTION_SEPARATOR);

    const factoryProxyAddress = vaultFactoryAddress
    const factoryImplAddress = await upgrades.erc1967.getImplementationAddress(factoryProxyAddress)
    contractInfo["VaultFactory"] = {
        "contractAddress": factoryImplAddress,

        "constructorArgs": []
    };

    console.log("Vault factory contract info written.");
    console.log(SUBSECTION_SEPARATOR);

    contractInfo["FeeController"] = {
        "contractAddress": feeControllerAddress,

        "constructorArgs": []
    };

    console.log("Fee controller contract info written.");
    console.log(SUBSECTION_SEPARATOR);

    let promissoryNoteDataBn: PromissoryNoteTypeBn = {

        "contractAddress": borrowerNoteAddress,

        "constructorArgs": ["Arcade.xyz BorrowerNote", "aBN"]

    };

    contractInfo["BorrowerNote"] = promissoryNoteDataBn

    console.log("Borrower note contract info written.");

    let promissoryNoteDataLn: PromissoryNoteTypeLn = {

        "contractAddress": lenderNoteAddress,

        "constructorArgs": ["Arcade.xyz LenderNote", "aLN"]

    };

    contractInfo["LenderNote"] = promissoryNoteDataLn

    console.log("Lender note contract info written.");
    console.log(SUBSECTION_SEPARATOR);

    const loanCoreProxyAddress = loanCoreAddress
    const loanCoreImplAddress = await upgrades.erc1967.getImplementationAddress(loanCoreProxyAddress);
    contractInfo["LoanCore"] = {
        "contractAddress": loanCoreImplAddress,

        "constructorArgs": []
    };

    console.log("Loan core contract info written.");
    console.log(SUBSECTION_SEPARATOR);

    contractInfo["RepaymentController"] = {
        "contractAddress": repaymentContAddress,

        "constructorArgs": [loanCoreProxyAddress, borrowerNoteAddress, lenderNoteAddress]
    };

    console.log("Repayment controller contract info written.");
    console.log(SECTION_SEPARATOR);

    const originationContProxyAddress = originationContAddress
    const originationContImplAddress = await upgrades.erc1967.getImplementationAddress(originationContProxyAddress)
    contractInfo["OriginationController"] = {
        "contractAddress": originationContImplAddress,

        "constructorArgs": []
    };

    console.log("Origination controller contract info written.");
}