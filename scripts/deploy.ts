import hre, { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { ORIGINATOR_ROLE as DEFAULT_ORIGINATOR_ROLE, REPAYER_ROLE as DEFAULT_REPAYER_ROLE, ADMIN_ROLE as DEFAULT_ADMIN_ROLE } from "./constants";

import {
    AssetVault,
    FeeController,
    LoanCore,
    PromissoryNote,
    RepaymentController,
    OriginationController,
    CallWhitelist,
    VaultFactory,
} from "../typechain";
export interface DeployedResources {
    assetVault: AssetVault;
    feeController: FeeController;
    loanCore: LoanCore;
    borrowerNote: PromissoryNote;
    lenderNote: PromissoryNote;
    repaymentController: RepaymentController;
    originationController: OriginationController;
    whitelist: CallWhitelist;
    vaultFactory: VaultFactory;
    admin: SignerWithAddress;
}
let MINTING_ROLE;
export async function main(
    ORIGINATOR_ROLE = DEFAULT_ORIGINATOR_ROLE,
    REPAYER_ROLE = DEFAULT_REPAYER_ROLE,

): Promise<DeployedResources> {
    // Hardhat always runs the compile task when running scripts through it.
    // If this runs in a standalone fashion you may want to call compile manually
    // to make sure everything is compiled
    // await run("compile");
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();
    const [admin] = signers;

    const CallWhiteListFactory = await ethers.getContractFactory("CallWhitelist");
    const whitelist = <CallWhitelist>await CallWhiteListFactory.deploy();

    // We get the contract to deploy
    const AssetVaultFactory = await ethers.getContractFactory("AssetVault");
    const assetVault = <AssetVault>await AssetVaultFactory.deploy();
    await assetVault.deployed();

    console.log("AssetVault deployed to:", assetVault.address);

    const FeeControllerFactory = await ethers.getContractFactory("FeeController");
    const feeController = <FeeController>await FeeControllerFactory.deploy();
    await feeController.deployed();

    console.log("FeeController deployed to: ", feeController.address);

    const PromissoryNoteFactory = await ethers.getContractFactory("PromissoryNote");
    const borrowerNote = <PromissoryNote>await PromissoryNoteFactory.deploy("Arcade.xyz BorrowerNote", "aBN");
    await borrowerNote.deployed()
    const lenderNote = <PromissoryNote>await PromissoryNoteFactory.deploy("Arcade.xyz LenderNote", "aLN");
    await lenderNote.deployed()
    console.log("BorrowerNote deployed to:", borrowerNote.address);
    console.log("LenderNote deployed to:", lenderNote.address);

    const LoanCoreFactory = await ethers.getContractFactory("LoanCore");
    const loanCore = <LoanCore>await upgrades.deployProxy(LoanCoreFactory, [feeController.address, borrowerNote.address, lenderNote.address], { kind: "uups" });
    await loanCore.deployed();
    console.log("LoanCore deployed to:", loanCore.address);

    // Grant correct permissions for promissory note
    // Giving to user to call PromissoryNote functions directly
    for (const note of [borrowerNote, lenderNote]) {
        await note.connect(admin).initialize(loanCore.address);
    }

    const RepaymentControllerFactory = await ethers.getContractFactory("RepaymentController");
    const repaymentController = <RepaymentController>(
         await RepaymentControllerFactory.deploy(loanCore.address, borrowerNote.address, lenderNote.address)
    );
    await repaymentController.deployed();

    const updateRepaymentControllerPermissions = await loanCore.grantRole(REPAYER_ROLE, repaymentController.address);
    await updateRepaymentControllerPermissions.wait();
    console.log("RepaymentController deployed to:", repaymentController.address);

    const OriginationControllerFactory = await ethers.getContractFactory("OriginationController");
    const originationController = <OriginationController>(
        await upgrades.deployProxy(OriginationControllerFactory, [loanCore.address], { kind: "uups" })
    );
    await originationController.deployed();
    const updateOriginationControllerPermissions = await loanCore.grantRole(
        ORIGINATOR_ROLE,
        originationController.address,
    );
    await updateOriginationControllerPermissions.wait();
    console.log("OriginationController deployed to:", originationController.address);

    const VaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
    const vaultFactory = <VaultFactory>await upgrades.deployProxy(
        VaultFactoryFactory,
        [assetVault.address, whitelist.address],
        {
            kind: "uups",
            initializer: "initialize(address, address)",
        },
    );
    console.log("VaultFactory deployed to:", vaultFactory.address);

    return {
        assetVault,
        feeController,
        loanCore,
        borrowerNote,
        lenderNote,
        repaymentController,
        originationController,
        whitelist,
        vaultFactory,
        admin
    };
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
