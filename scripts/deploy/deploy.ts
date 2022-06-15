import { ethers, upgrades } from "hardhat";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
import { main as writeJson } from "../utils/verify/writeJson";
import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../utils/bootstrap-tools";
import {
    AssetVault,
    FeeController,
    LoanCore,
    PromissoryNote,
    RepaymentController,
    OriginationController,
    CallWhitelist,
    VaultFactory,
} from "../../typechain";

dotenvConfig({ path: resolve(__dirname, "../../.env") });

export interface deploymentData {
    [contractName: string]: contractData | PromissoryNoteTypeBn | PromissoryNoteTypeLn;
}
export interface contractData {
    contractAddress: string;
    contractImplementationAddress: string;
    constructorArgs: any[];
}

export interface PromissoryNoteTypeBn {
    contractAddress: string;
    constructorArgs: any[];
}

export interface PromissoryNoteTypeLn {
    contractAddress: string;
    constructorArgs: any[];
}

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
}

// nonce debug toggle
const DEBUG_NONCE = false;

export async function main(): Promise<DeployedResources> {

    // deployer address from .env
    let deployerAddr: string;
    if(process.env.ARCADE_DEPLOYER_ADDRESS) {
      deployerAddr = process.env.ARCADE_DEPLOYER_ADDRESS;
    } else {
      throw new Error("ADDRESS environment variable is not set.")
    }

    // get deployer accounts current transaction count to create the nonce
    // upgradeable contracts using deployProxy do have a custom nonce added to them
    let nonce_counter = await ethers.provider.getTransactionCount(deployerAddr);

    console.log(SECTION_SEPARATOR);
    console.log("Deploying protocol...")

    // ======= CallWhiteList =======
    console.log(SUBSECTION_SEPARATOR);
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    const CallWhiteListFactory = await ethers.getContractFactory("CallWhitelist");
    const whitelist = <CallWhitelist> await CallWhiteListFactory.deploy({ nonce: nonce_counter });
    await whitelist.deployed();
    console.log("CallWhiteList deployed to:", whitelist.address);

    // ======= AssetVault =======
    console.log(SUBSECTION_SEPARATOR);
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    const AssetVaultFactory = await ethers.getContractFactory("AssetVault");
    const assetVault = <AssetVault> await AssetVaultFactory.deploy({ nonce: nonce_counter });
    await assetVault.deployed();
    console.log("AssetVault deployed to:", assetVault.address);

    // ======= VaultFactory =======
    console.log(SUBSECTION_SEPARATOR);
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    const VaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
    const vaultFactory = <VaultFactory> await upgrades.deployProxy(
        VaultFactoryFactory,
        [assetVault.address, whitelist.address],
        {
            kind: "uups",
            initializer: "initialize(address, address)",
        },
    );
    await vaultFactory.deployed();
    console.log("VaultFactory proxy deployed to:", vaultFactory.address);

    // ======= FeeController =======
    console.log(SUBSECTION_SEPARATOR);
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    const FeeControllerFactory = await ethers.getContractFactory("FeeController");
    const feeController = <FeeController> await FeeControllerFactory.deploy({ nonce: nonce_counter });
    await feeController.deployed();
    console.log("FeeController deployed to: ", feeController.address);

    // ======= BorrowerNote =======
    console.log(SUBSECTION_SEPARATOR);
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    const bNoteName = "Arcade.xyz BorrowerNote";
    const bNoteSymbol = "aBN";
    const PromissoryNoteFactory = await ethers.getContractFactory("PromissoryNote");
    const borrowerNote = <PromissoryNote> await PromissoryNoteFactory.deploy(bNoteName, bNoteSymbol, { nonce: nonce_counter });
    await borrowerNote.deployed();
    console.log("BorrowerNote deployed to:", borrowerNote.address);

    // ======= LenderNote =======
    console.log(SUBSECTION_SEPARATOR);
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    const lNoteName = "Arcade.xyz LenderNote";
    const lNoteSymbol = "aLN";
    const lenderNote = <PromissoryNote> await PromissoryNoteFactory.deploy(lNoteName, lNoteSymbol, { nonce: nonce_counter });
    await lenderNote.deployed();
    console.log("LenderNote deployed to:", lenderNote.address);

    // ======= LoanCore =======
    console.log(SUBSECTION_SEPARATOR);
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    const LoanCoreFactory = await ethers.getContractFactory("LoanCore");
    const loanCore = <LoanCore>await upgrades.deployProxy(
        LoanCoreFactory,
        [feeController.address, borrowerNote.address, lenderNote.address],
        {
            kind: "uups",
        },
    );
    await loanCore.deployed();
    console.log("LoanCore proxy deployed to:", loanCore.address);

    // ======= RepaymentController =======
    console.log(SUBSECTION_SEPARATOR);
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    const RepaymentControllerFactory = await ethers.getContractFactory("RepaymentController");
    const repaymentController = <RepaymentController>(
        await RepaymentControllerFactory.deploy(loanCore.address, { nonce: nonce_counter })
    );
    await repaymentController.deployed();
    console.log("RepaymentController deployed to:", repaymentController.address);

    // ======= OriginationController =======
    console.log(SUBSECTION_SEPARATOR);
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    const OriginationControllerFactory = await ethers.getContractFactory("OriginationController");
    const originationController = <OriginationController>(
        await upgrades.deployProxy(OriginationControllerFactory, [loanCore.address], { kind: "uups" })
    );
    await originationController.deployed();
    console.log("OriginationController proxy deployed to:", originationController.address);

    ///////////////// WRITE JSON \\\\\\\\\\\\\\\\\\
    console.log(SECTION_SEPARATOR);
    console.log("Saving deployments...");
    await writeJson(
        assetVault.address,
        feeController.address,
        borrowerNote.address,
        lenderNote.address,
        repaymentController.address,
        whitelist.address,
        vaultFactory.address,
        loanCore.address,
        originationController.address,
        bNoteName,
        bNoteSymbol,
        lNoteName,
        lNoteSymbol,
    );
    console.log(SECTION_SEPARATOR);

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
    };
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}
