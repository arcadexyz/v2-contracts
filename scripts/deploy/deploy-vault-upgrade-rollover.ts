import hre, { ethers } from "hardhat";
import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../utils/bootstrap-tools";

import {
    FlashRolloverStakingVaultUpgrade
} from "../../typechain";

export interface DeployedResources {
    flashRollover: FlashRolloverStakingVaultUpgrade;
}

export async function main(): Promise<DeployedResources> {
    // Hardhat always runs the compile task when running scripts through it.
    // If this runs in a standalone fashion you may want to call compile manually
    // to make sure everything is compiled
    // await run("compile");

    const MULTISIG = "0x398e92C827C5FA0F33F171DC8E20570c5CfF330e";
    const VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

    console.log(SECTION_SEPARATOR);

    console.log("Deploying rollover...");

    const factory = await ethers.getContractFactory("FlashRolloverStakingVaultUpgrade")
    const flashRollover = <FlashRolloverStakingVaultUpgrade>await factory.deploy(VAULT_ADDRESS);

    console.log("Rollover deployed to:", flashRollover.address);

    await flashRollover.transferOwnership(MULTISIG);

    console.log("Rollover ownership transferred to multisig.");

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
