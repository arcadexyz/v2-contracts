/* eslint no-unused-vars: 0 */
const fs = require("fs");
import hre, { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { SUBSECTION_SEPARATOR, SECTION_SEPARATOR, vaultAssetsAndMakeLoans } from "./utils/bootstrap-tools";
import { mintAndDistribute } from "./utils/mint-distribute-assets";
import { deployNFTs } from "./utils/deploy-assets";
import { config } from "../hardhat.config";

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
    lenderNote: Contract,
    loanCore: Contract,
    feeController: Contract,
    whitelist: Contract,
): Promise<void> {
    // Bootstrap five accounts only.
    // Skip the first account, since the
    // first signer will be the deployer.
    let signers: SignerWithAddress[] = await hre.ethers.getSigners();
    signers = (await ethers.getSigners()).slice(0, 6);
    const deployer = signers[0];

    console.log("Deployer address:", deployer.address);
    // Get deployer balance
    const provider = ethers.provider;
    const balance = await provider.getBalance(deployer.address);
    console.log("Deployer balance:", balance.toString());

    // Set admin address
    const ADMIN_ADDRESS = process.env.ADMIN_MULTISIG;
    console.log("Admin address:", ADMIN_ADDRESS);

    const FACTORY_ADDRESS = factory.address;
    const ORIGINATION_CONTROLLER_ADDRESS = originationController.address;
    const LOAN_CORE_ADDRESS = loanCore.address;
    const FEE_CONTROLLER_ADDRESS = feeController.address;
    const REPAYMENT_CONTROLLER_ADDRESS = repaymentController.address;
    const CALL_WHITELIST_ADDRESS = whitelist.address;

    console.log(SECTION_SEPARATOR);
    console.log("Deploying resources...\n");

    // Mint some NFTs
    const { punks, art, beats, weth, pawnToken, usd } = await deployNFTs();

    // Distribute NFTs and ERC20s
    console.log(SUBSECTION_SEPARATOR);
    console.log("Distributing assets...\n");
    await mintAndDistribute(signers, weth, pawnToken, usd, punks, art, beats);

    // Vault some assets
    console.log(SECTION_SEPARATOR);
    console.log("Vaulting assets...\n");
    await vaultAssetsAndMakeLoans(
        signers,
        FACTORY_ADDRESS,
        originationController,
        borrowerNote,
        repaymentController,
        lenderNote,
        loanCore,
        feeController,
        whitelist,
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
    let jsonData = JSON.parse(readData);
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
            repaymentController,
            lenderNote,
            loanCore,
            feeController,
            whitelist,
        } = res;
        main(
            factory,
            originationController,
            borrowerNote,
            repaymentController,
            lenderNote,
            loanCore,
            feeController,
            whitelist,
        )
            .then(() => process.exit(0))
            .catch((error: Error) => {
                console.error(error);
            });
    });
}