import { upgrades } from "hardhat";

import { deploymentData, PromissoryNoteTypeBn, PromissoryNoteTypeLn } from "../../deploy/deploy";

export let contractInfo: deploymentData = {};
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
    contractInfo["CallWhitelist"] = {
        contractAddress: whitelistAddress,

        constructorArgs: [],
    };

    contractInfo["AssetVault"] = {
        contractAddress: assetVaultAddress,

        constructorArgs: [],
    };

    const factoryProxyAddress = vaultFactoryAddress;
    const factoryImplAddress = await upgrades.erc1967.getImplementationAddress(factoryProxyAddress);
    contractInfo["VaultFactory"] = {
        contractAddress: factoryImplAddress,

        constructorArgs: [],
    };

    contractInfo["FeeController"] = {
        contractAddress: feeControllerAddress,

        constructorArgs: [],
    };

    let promissoryNoteDataBn: PromissoryNoteTypeBn = {
        contractAddress: borrowerNoteAddress,

        constructorArgs: [bNoteName, bNoteSymbol],
    };
    contractInfo["BorrowerNote"] = promissoryNoteDataBn;

    let promissoryNoteDataLn: PromissoryNoteTypeLn = {
        contractAddress: lenderNoteAddress,

        constructorArgs: [lNoteName, lNoteSymbol],
    };
    contractInfo["LenderNote"] = promissoryNoteDataLn;

    const loanCoreProxyAddress = loanCoreAddress;
    const loanCoreImplAddress = await upgrades.erc1967.getImplementationAddress(loanCoreProxyAddress);
    contractInfo["LoanCore"] = {
        contractAddress: loanCoreImplAddress,

        constructorArgs: [],
    };

    contractInfo["RepaymentController"] = {
        contractAddress: repaymentContAddress,

        constructorArgs: [loanCoreProxyAddress, borrowerNoteAddress, lenderNoteAddress],
    };

    const originationContProxyAddress = originationContAddress;
    const originationContImplAddress = await upgrades.erc1967.getImplementationAddress(originationContProxyAddress);
    contractInfo["OriginationController"] = {
        contractAddress: originationContImplAddress,

        constructorArgs: [],
    };
}
