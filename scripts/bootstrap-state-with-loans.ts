/* eslint no-unused-vars: 0 */
import fs from "fs";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { vaultAssetsAndMakeLoans } from "./utils/vault-assets-make-loans"
import { SUBSECTION_SEPARATOR, SECTION_SEPARATOR } from "./utils/constants";
import { mintAndDistribute } from "./utils/mint-distribute-assets";
import { deployAssets } from "./utils/deploy-assets";
import { config } from "./../hardhat.config";

const jsonContracts: { [key: string]: string } = {
    CallWhitelist: "whitelist",
    AssetVault: "assetVault",
    VaultFactory: "factory",
    FeeController: "feeController",
    BorrowerNote: "borrowerNote",
    LenderNote: "lenderNote",
    LoanCore: "loanCore",
    RepaymentController: "repaymentController",
    OriginationController: "originationController",
};
type ContractArgs = {
    whitelist: Contract;
    assetVault: Contract;
    factory: Contract;
    feeController: Contract;
    borrowerNote: Contract;
    lenderNote: Contract;
    loanCore: Contract;
    repaymentController: Contract;
    originationController: Contract;
};

export async function main(
    factory: Contract,
    originationController: Contract,
    borrowerNote: Contract,
    repaymentController: Contract,
): Promise<void> {
    // Bootstrap five accounts, skip the first account, since the
    // first signer will be the deployer account in hardhat.config.
    let signers: SignerWithAddress[] = await ethers.getSigners();
    signers = (await ethers.getSigners()).slice(0, 6);
    const deployer = signers[0];

    // Get deployer balance
    console.log("Deployer address:", deployer.address);
    const provider = ethers.provider;
    const balance = await provider.getBalance(deployer.address);
    console.log("Deployer balance:", balance.toString());

    // Mint some NFTs
    console.log(SECTION_SEPARATOR);
    console.log("Deploying resources...\n");
    const { punks, art, beats, weth, pawnToken, usd } = await deployAssets();

    // Distribute NFTs and ERC20s
    console.log(SUBSECTION_SEPARATOR);
    console.log("Distributing assets...\n");
    await mintAndDistribute(weth, pawnToken, usd, punks, art, beats);

    // Vault some assets
    console.log(SECTION_SEPARATOR);
    console.log("Vaulting assets...\n");
    const FACTORY_ADDRESS = factory.address;
    await vaultAssetsAndMakeLoans(
        FACTORY_ADDRESS,
        originationController,
        borrowerNote,
        repaymentController,
        punks,
        usd,
        beats,
        weth,
        art,
        pawnToken,
    );

    // End state:
    // 0 is clean (but has a bunch of tokens and NFTs)
    // 1 has 2 bundles and 1 open borrow, one closed borrow
    // 2 has two open lends and one closed lend
    // 3 has 3 bundles, two open borrows, one closed borrow, and one closed lend
    // 4 has 1 bundle, an unused bundle, one open lend and one open borrow
}

async function attachAddresses(jsonFile: string): Promise<any> {
    let readData = fs.readFileSync(jsonFile);
    let jsonData = JSON.parse(readData.toString());
    let contracts: { [key: string]: Contract } = {};
    for await (let key of Object.keys(jsonData)) {
        if (!(key in jsonContracts)) continue;
        const argKey: string = jsonContracts[key];
        console.log(`Key: ${key}, address: ${jsonData[key]["contractAddress"]}`);
        let contract: Contract;
        if (key === "BorrowerNote" || key === "LenderNote") {
            contract = await ethers.getContractAt("PromissoryNote", jsonData[key]["contractAddress"]);
        } else {
            contract = await ethers.getContractAt(key, jsonData[key]["contractAddress"]);
        }
        contracts[argKey] = contract;
    }
    return contracts;
}

if (require.main === module) {
    // retrieve command line args array
    const args = process.argv.slice(2);

    // assemble args to access the relevant deplyment json in .deployment
    const file = `./.deployments/${args[0]}/${args[0]}-${args[1]}.json`;

    attachAddresses(file).then((res: ContractArgs) => {
        let {
            factory,
            originationController,
            borrowerNote,
            repaymentController
        } = res;
        main(
            factory,
            originationController,
            borrowerNote,
            repaymentController
        )
            .then(() => process.exit(0))
            .catch((error: Error) => {
                console.error(error);
            });
    });
}
