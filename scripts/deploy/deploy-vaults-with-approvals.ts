import hre, { ethers, upgrades } from "hardhat";
import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../utils/bootstrap-tools";

import {
    VaultFactory,
    AssetVault,
    CallWhitelistApprovals
} from "../../typechain";

export interface DeployedResources {
    factory: VaultFactory;
    whitelist: CallWhitelistApprovals;
    template: AssetVault;
}

export async function main(): Promise<DeployedResources> {
    // Hardhat always runs the compile task when running scripts through it.
    // If this runs in a standalone fashion you may want to call compile manually
    // to make sure everything is compiled
    // await run("compile");

    const ARCADE_MSIG = "0x398e92C827C5FA0F33F171DC8E20570c5CfF330e";

    console.log(SECTION_SEPARATOR);

    const whitelistFactory = await hre.ethers.getContractFactory("CallWhitelistApprovals");
    const whitelist = <CallWhitelistApprovals>await whitelistFactory.deploy();
    await whitelist.deployed();
    await whitelist.transferOwnership(ARCADE_MSIG);

    console.log("CallWhitelistApprovals deployed to:", whitelist.address);

    const vaultTemplate = await hre.ethers.getContractFactory("AssetVault");
    const template = <AssetVault>await vaultTemplate.deploy();
    await template.deployed();

    console.log("AssetVault template deployed to:", template.address);

    const vfFactory = await hre.ethers.getContractFactory("VaultFactory");
    const factory = <VaultFactory>await upgrades.deployProxy(
        vfFactory,
        [template.address, whitelist.address],
        { kind: "uups" },
    );

    console.log("VaultFactory deployed to:", factory.address);

    return { factory, whitelist, template };
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
