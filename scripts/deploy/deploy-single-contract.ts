import hre, { ethers } from "hardhat";
import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../utils/bootstrap-tools";

import { Contract } from "ethers";

export interface DeployedResources {
    contract: Contract;
}

export async function main(): Promise<DeployedResources> {
    // Hardhat always runs the compile task when running scripts through it.
    // If this runs in a standalone fashion you may want to call compile manually
    // to make sure everything is compiled
    // await run("compile");

    const CONTRACT_NAME: string = "LoanCore";
    const ARGS: string[] = [];

    console.log(SECTION_SEPARATOR);

    const factory = await ethers.getContractFactory(CONTRACT_NAME);
    const contract = <Contract>await factory.deploy(...ARGS);
    await contract.deployed();

    console.log(`Contract ${CONTRACT_NAME} deployed to:`, contract.address);

    return { contract };
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
