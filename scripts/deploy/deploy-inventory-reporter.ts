import hre, { ethers } from "hardhat";
import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../utils/bootstrap-tools";

import {
    VaultDepositRouter,
    VaultInventoryReporter
} from "../../typechain";

export interface DeployedResources {
    reporter: VaultInventoryReporter;
    router: VaultDepositRouter;
}

export async function main(): Promise<DeployedResources> {
    // Hardhat always runs the compile task when running scripts through it.
    // If this runs in a standalone fashion you may want to call compile manually
    // to make sure everything is compiled
    // await run("compile");

    console.log(SECTION_SEPARATOR);

    // const VAULT_FACTORY = "0x6e9B4c2f6Bd57b7b924d29b5dcfCa1273Ecc94A2"; // mainnet
    const VAULT_FACTORY = "0x0028BADf5d154DAE44F874AC58FFCd3fA56D9586" // goerli

    const reporterFactory = await ethers.getContractFactory("VaultInventoryReporter");
    // const reporter = <VaultInventoryReporter>await reporterFactory.deploy();
    const reporter = <VaultInventoryReporter>await reporterFactory.attach("0x606E4a441290314aEaF494194467Fd2Bb844064A");
    await reporter.deployed();

    // console.log("Inventory Reporter deployed to:", reporter.address);

    const routerFactory = await ethers.getContractFactory("VaultDepositRouter");
    const router = <VaultDepositRouter>await routerFactory.deploy(VAULT_FACTORY, reporter.address);
    await router.deployed();

    console.log("Vault Deposit Router deployed to:", router.address);

    return { reporter, router };
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
