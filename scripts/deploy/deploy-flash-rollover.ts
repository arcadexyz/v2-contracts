import hre, { ethers } from "hardhat";
import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../utils/bootstrap-tools";

import {
    FlashRolloverV1toV2
} from "../../typechain";

export interface DeployedResources {
    flashRollover: FlashRolloverV1toV2;
}

export async function main(): Promise<DeployedResources> {
    // Hardhat always runs the compile task when running scripts through it.
    // If this runs in a standalone fashion you may want to call compile manually
    // to make sure everything is compiled
    // await run("compile");

    const ADDRESSES_PROVIDER_ADDRESS = "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5";

    console.log(SECTION_SEPARATOR);

    console.log("Deploying rollover...");

    const factory = await ethers.getContractFactory("FlashRolloverV1toV2")
    const flashRollover = <FlashRolloverV1toV2>await factory.deploy(ADDRESSES_PROVIDER_ADDRESS);

    console.log("Rollover deployed to:", flashRollover.address);

    return { flashRollover };
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
