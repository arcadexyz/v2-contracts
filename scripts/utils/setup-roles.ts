const fs = require("fs");
import hre, { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// This is imported to extend into this file: import "@nomiclabs/hardhat-ethers";
import { config } from "../../hardhat.config";

import { SUBSECTION_SEPARATOR, SECTION_SEPARATOR } from "./bootstrap-tools";

import {
    ORIGINATOR_ROLE as DEFAULT_ORIGINATOR_ROLE,
    ADMIN_ROLE as DEFAULT_ADMIN_ROLE,
    FEE_CLAIMER_ROLE as DEFAULT_FEE_CLAIMER_ROLE,
    REPAYER_ROLE as DEFAULT_REPAYER_ROLE,
} from "./constants";

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
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();
    const [deployer] = signers;

    console.log("Deployer address:", deployer.address);
    // Get deployer balance
    const provider = ethers.provider;
    const balance = await provider.getBalance(deployer.address);
    console.log("Deployer balance:", balance.toString());

    // Set admin address
    const ADMIN_ADDRESS = process.env.ADMIN_MULTISIG;
    console.log("Admin address:", ADMIN_ADDRESS);

    // Define roles
    const ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    const FEE_CLAIMER_ROLE = DEFAULT_FEE_CLAIMER_ROLE;
    const ORIGINATOR_ROLE = DEFAULT_ORIGINATOR_ROLE;
    const REPAYER_ROLE = DEFAULT_REPAYER_ROLE;

    const ORIGINATION_CONTROLLER_ADDRESS = originationController.address;
    const LOAN_CORE_ADDRESS = loanCore.address;
    const FEE_CONTROLLER_ADDRESS = feeController.address;
    const REPAYMENT_CONTROLLER_ADDRESS = repaymentController.address;
    const CALL_WHITELIST_ADDRESS = whitelist.address;

    if (!LOAN_CORE_ADDRESS) {
        throw new Error("Must specify LOAN_CORE_ADDRESS in environment!");
    }

    if (!ADMIN_ADDRESS) {
        throw new Error("Must specify ADMIN_ADDRESS in environment!");
    }

    if (FEE_CONTROLLER_ADDRESS) {
        console.log("Fee controller address:", FEE_CONTROLLER_ADDRESS);
    }

    console.log(SECTION_SEPARATOR);

    // grant correct permissions for promissory note
    // giving to user to call PromissoryNote functions directly
    for (const note of [borrowerNote, lenderNote]) {
        await note.initialize(LOAN_CORE_ADDRESS);
    }

    console.log(`borrowerNote and lenderNote have initalized loanCore at address: ${LOAN_CORE_ADDRESS}`);
    console.log(SUBSECTION_SEPARATOR);

    // grant LoanCore the admin role to enable authorizeUpgrade onlyRole(DEFAULT_ADMIN_ROLE)
    const updateLoanCoreAdmin = await loanCore.grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await updateLoanCoreAdmin.wait();

    console.log(`loanCore has granted admin role: ${ADMIN_ROLE} to address: ${ADMIN_ADDRESS}`);
    console.log(SUBSECTION_SEPARATOR);

    // grant LoanCore admin fee claimer permissions
    const updateLoanCoreFeeClaimer = await loanCore.grantRole(FEE_CLAIMER_ROLE, ADMIN_ADDRESS);
    await updateLoanCoreFeeClaimer.wait();

    console.log(`loanCore has granted fee claimer role: ${FEE_CLAIMER_ROLE} to address: ${ADMIN_ADDRESS}`);
    console.log(SUBSECTION_SEPARATOR);

    // grant VaultFactory the admin role to enable authorizeUpgrade onlyRole(DEFAULT_ADMIN_ROLE)
    const updateVaultFactoryAdmin = await factory.grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await updateVaultFactoryAdmin.wait();

    console.log(`vaultFactory has granted admin role: ${ADMIN_ROLE} to address: ${ADMIN_ADDRESS}`);
    console.log(SUBSECTION_SEPARATOR);

    // grant originationContoller the owner role to enable authorizeUpgrade onlyOwner
    const updateOriginationControllerAdmin = await loanCore.grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await updateOriginationControllerAdmin.wait();

    console.log(`originationController has granted admin role: ${ADMIN_ROLE} to address: ${ADMIN_ADDRESS}`);
    console.log(SUBSECTION_SEPARATOR);

    // borrowerNote grants the admin role to the admin address
    const promissoryNoteAdminBn = await loanCore.grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await promissoryNoteAdminBn.wait();

    console.log(`borrowerNote has granted admin role: ${ADMIN_ROLE} to address: ${ADMIN_ADDRESS}`);
    console.log(SUBSECTION_SEPARATOR);

    // lenderNote grants the admin role to the admin address
    const promissoryNoteAdminLn = await loanCore.grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await promissoryNoteAdminLn.wait();

    console.log(`lenderNote has granted admin role: ${ADMIN_ROLE} to address: ${ADMIN_ADDRESS}`);
    console.log(SUBSECTION_SEPARATOR);

    // grant originationContoller the originator role
    const updateOriginationControllerRole = await loanCore.grantRole(ORIGINATOR_ROLE, ORIGINATION_CONTROLLER_ADDRESS);
    await updateOriginationControllerRole.wait();

    console.log(
        `originationController has granted originator role: ${ORIGINATOR_ROLE} to address: ${ORIGINATION_CONTROLLER_ADDRESS}`,
    );
    console.log(SUBSECTION_SEPARATOR);

    // grant repaymentContoller the REPAYER_ROLE
    const updateRepaymentControllerAdmin = await loanCore
        .grantRole(REPAYER_ROLE, REPAYMENT_CONTROLLER_ADDRESS);
    await updateRepaymentControllerAdmin.wait();

    console.log(`loanCore has granted repayer role: ${REPAYER_ROLE} to address: ${REPAYMENT_CONTROLLER_ADDRESS}`);
    console.log(SECTION_SEPARATOR);

    // renounce ownership from deployer
    const renounceAdmin = await loanCore.renounceRole(ADMIN_ROLE, await deployer.address);
    await renounceAdmin.wait();

    console.log(`loanCore has renounced admin role.`);
    console.log(SUBSECTION_SEPARATOR);

    const renounceOriginationControllerAdmin = await loanCore.renounceRole(ADMIN_ROLE, deployer.address);
    await renounceOriginationControllerAdmin.wait();

    console.log(`originationController has renounced originator role.`);
    console.log(SUBSECTION_SEPARATOR);

    const renounceVaultFactoryAdmin = await factory.renounceRole(ADMIN_ROLE, deployer.address);
    await renounceVaultFactoryAdmin.wait();

    console.log(`vaultFactory has renounced admin role.`);
    console.log(SUBSECTION_SEPARATOR);

    // renounce ownership from loanCore
    const renounceBorrowerNoteAdmin = await loanCore.renounceRole(ADMIN_ROLE, deployer.address);
    await renounceBorrowerNoteAdmin.wait();

    console.log(`borrowerNote has renounced admin role.`);
    console.log(SUBSECTION_SEPARATOR);

    // renounce ownership from loanCore
    const renounceLenderNoteAdmin = await loanCore.renounceRole(ADMIN_ROLE, deployer.address);
    await renounceLenderNoteAdmin.wait();

    console.log(`lenderNote has renounced admin role.`);
    console.log(SECTION_SEPARATOR);

    if (FEE_CONTROLLER_ADDRESS) {
        // set FeeController admin
        const feeController = await ethers.getContractAt("FeeController", FEE_CONTROLLER_ADDRESS);
        const updateFeeControllerAdmin = await feeController.transferOwnership(ADMIN_ADDRESS);
        await updateFeeControllerAdmin.wait();
    }

    console.log(`feeController has transferred ownership to address: ${ADMIN_ADDRESS}`);
    console.log(SUBSECTION_SEPARATOR);

    if (CALL_WHITELIST_ADDRESS) {
        // set CallWhiteList admin
        const whitelist = await ethers.getContractAt("CallWhitelist", CALL_WHITELIST_ADDRESS);
        const updateWhitelistAdmin = await whitelist.transferOwnership(ADMIN_ADDRESS);
        await updateWhitelistAdmin.wait();
    }

    console.log(`whitelist has transferred ownership to address: ${ADMIN_ADDRESS}`);
    console.log(SECTION_SEPARATOR);

    console.log("Transferred all ownership.\n");
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
                process.exit(1);
            });
    });
}
