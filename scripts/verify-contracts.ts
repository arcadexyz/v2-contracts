const fs = require("fs");
import hre from "hardhat";

import { contractData } from "./deploy/deploy";

import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "./utils/bootstrap-tools";

<<<<<<< HEAD
async function verifyArtifacts(contractName: string, contractAddress: string, constructorArgs: any[]) {
    console.log(`${contractName}: ${contractAddress}`);
    console.log(SUBSECTION_SEPARATOR);

    await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: constructorArgs,
    });

    console.log(`${contractName}: ${contractAddress}`, "has been verified.");
=======
async function verifyArtifacts(
    contractName: string,
    contractAddress: string,
    contractImplementationAddress: string,
    constructorArgs: any[],
) {
    console.log(`${contractName}: ${contractAddress}`);
    console.log(SUBSECTION_SEPARATOR);

    let address;

    if (contractImplementationAddress === "") {
        address = contractAddress;
    } else {
        address = contractImplementationAddress;
    }

    await hre.run("verify:verify", {
        address,
        constructorArguments: constructorArgs,
    });

    console.log(`${contractName}: ${address}`, "has been verified.");
>>>>>>> e70cda1 (chore(feat-setup-roles): pre rebase commit)
    console.log(SECTION_SEPARATOR);
}

// get data from deployments json to run verify artifacts
export async function main(): Promise<void> {
    // retrieve command line args array
    const args = process.argv.slice(2);

    // assemble args to access the relevant deplyment json in .deployment
    const file = `./.deployments/${args[0]}/${args[0]}-${args[1]}.json`;

    console.log("deployment file being verified: ", file);
    console.log(SUBSECTION_SEPARATOR);

    // read deplyment json to get contract addresses and constructor arguments
    let readData = fs.readFileSync(file);
    let jsonData = JSON.parse(readData);

    // loop through jsonData to run verifyArtifacts function
    for (const property in jsonData) {
        let dataFromJson = <contractData>jsonData[property];
<<<<<<< HEAD
        await verifyArtifacts(property, dataFromJson.contractAddress, dataFromJson.constructorArgs);
=======
        await verifyArtifacts(
            property,
            dataFromJson.contractAddress,
            dataFromJson.contractImplementationAddress,
            dataFromJson.constructorArgs,
        );
>>>>>>> e70cda1 (chore(feat-setup-roles): pre rebase commit)
    }
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
