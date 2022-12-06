/* eslint no-unused-vars: 0 */

import hre, { ethers, upgrades } from "hardhat";
import { AssetVault, CallWhitelistApprovals, VaultFactory } from "../../typechain";

import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../utils/bootstrap-tools";
import { ADMIN_ROLE } from "../utils/constants";

export async function main(): Promise<void> {

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////                 GLOBALS                ////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const [deployer] = await hre.ethers.getSigners();

    const APE = "0x4d224452801ACEd8B2F0aebE155379bb5D594381"; // mainnet address
    // const APE = "0x328507DC29C95c170B56a1b3A758eB7a9E73455c"; // goerli address
    // const STAKING = "0x831e0c7A89Dbc52a1911b78ebf4ab905354C96Ce" // goerli address - mainnet address tbd
    // const STAKING = "0xeF37717B1807a253c6D140Aca0141404D23c26D4" // goerli address - mainnet address tbd
    const STAKING = "0x5954aB967Bc958940b7EB73ee84797Dc8a2AFbb9";
    // const OWNER = deployer.address; // goerli - should switch to multisig for mainnet
    const OWNER = "0x398e92C827C5FA0F33F171DC8E20570c5CfF330e"; // mainnet multisig

    console.log(SECTION_SEPARATOR);
    console.log("Deployer:", deployer.address);
    console.log(`Balance: ${ethers.utils.formatEther(await deployer.getBalance())} ETH`);
    console.log(SECTION_SEPARATOR);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////          STEP 1: CALLWHITELIST DEPLOY         /////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    // Set up lending protocol
    const whitelistFactory = await hre.ethers.getContractFactory("CallWhitelistApprovals");
    // const whitelist = <CallWhitelistApprovals>await whitelistFactory.deploy();
    const whitelist = <CallWhitelistApprovals>await whitelistFactory.attach("0xB4515A8e5616005f7138D9Eb25b581362d9FDB95");

    console.log("CallWhitelistApprovals deployed to:", whitelist.address);

    // // Whitelist BAYC deposit - depositBAYC
    // // await whitelist.add(STAKING, "0x8f4972a9");
    // await whitelist.add(STAKING, "0xd346cbd9");
    // // Whitelist MAYC deposit - depositMAYC
    // // await whitelist.add(STAKING, "0x4bd1e8f7");
    // await whitelist.add(STAKING, "0x8ecbffa7");
    // // Whitelist BAKC deposit - depositBAKC
    // // await whitelist.add(STAKING, "0x417a32f9");
    // await whitelist.add(STAKING, "0xd346cbd9");
    // // Whitelist BAYC claim - claimSelfBAYC
    // await whitelist.add(STAKING, "0x20a325d0");
    // // Whitelist MAYC claim - claimSelfMAYC
    // await whitelist.add(STAKING, "0x381b4682");
    // // Whitelist BAKC claim - claimSelfBAKC
    // // await whitelist.add(STAKING, "0xb0847dec");
    // await whitelist.add(STAKING, "0xe0347e4f");
    // // Whitelist BAYC withdraw - withdrawSelfBAYC
    // // await whitelist.add(STAKING, "0x3d0fa3b5");
    // await whitelist.add(STAKING, "0xfe31446c");
    // // Whitelist MAYC withdraw - withdrawSelfMAYC
    // await whitelist.add(STAKING, "0xc63389c3");
    // Whitelist BAKC withdraw  - withdrawBAKC
    // await whitelist.add(STAKING, "0x8536c652");
    await whitelist.add(STAKING, "0xaceb3629");

    // Set up approvals
    await whitelist.setApproval(APE, STAKING, true);

    console.log(SUBSECTION_SEPARATOR);
    console.log("Staking approvals set for:", STAKING);
    console.log("APE approval set for:", APE);
    console.log(SUBSECTION_SEPARATOR);

    // Transfer ownership
    if (OWNER !== deployer.address) {
        await whitelist.transferOwnership(OWNER);
        console.log("Whitelist ownership transferred to:", OWNER);
    } else {
        console.log("Whitelist ownership not transferred: deployer already owner.")
    }

    console.log(SECTION_SEPARATOR);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////          STEP 2: VAULT DEPLOY          /////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const vaultTemplate = await hre.ethers.getContractFactory("AssetVault");
    const template = <AssetVault>await vaultTemplate.deploy();
    await template.deployed();

    console.log("AssetVault deployed to:", template.address);

    const vfFactory = await hre.ethers.getContractFactory("VaultFactory");
    const factory = <VaultFactory>await upgrades.deployProxy(
        vfFactory,
        [template.address, whitelist.address],
        { kind: "uups" },
    );
    await factory.deployed();

    console.log("VaultFactory proxy deployed to:", factory.address);

    const implAddress = await upgrades.erc1967.getImplementationAddress(factory.address);
    console.log("VaultFactory implementation deployed to:", implAddress);

    console.log(SUBSECTION_SEPARATOR);

    // grant VaultFactory the admin role to enable authorizeUpgrade onlyRole(ADMIN_ROLE)
    const updateVaultFactoryAdmin = await factory.grantRole(ADMIN_ROLE, OWNER);
    await updateVaultFactoryAdmin.wait();

    console.log(`VaultFactory admin role granted to: ${OWNER}`);
    console.log(SUBSECTION_SEPARATOR);

    const renounceVaultFactoryAdmin = await factory.renounceRole(ADMIN_ROLE, deployer.address);
    await renounceVaultFactoryAdmin.wait();

    console.log("VaultFactory: deployer has renounced admin role");

    console.log(SECTION_SEPARATOR);
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
