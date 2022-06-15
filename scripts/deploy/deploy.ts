import hre, { ethers, upgrades } from "hardhat";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
import { main as writeJson } from "../utils/verify/writeJson";
import { SECTION_SEPARATOR, SUBSECTION_SEPARATOR } from "../utils/bootstrap-tools";
import { ORIGINATOR_ROLE as DEFAULT_ORIGINATOR_ROLE, REPAYER_ROLE as DEFAULT_REPAYER_ROLE } from "../utils/constants";
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

const DEBUG_NONCE = false;

export async function main(
    ORIGINATOR_ROLE = DEFAULT_ORIGINATOR_ROLE,
    REPAYER_ROLE = DEFAULT_REPAYER_ROLE,
): Promise<DeployedResources> {

    let deployerAddr: string;
    if(process.env.ADDRESS) {
      deployerAddr = process.env.ADDRESS;
    } else {
      throw new Error("ADDRESS environment variable is not set.")
    }
    let count = await ethers.provider.getTransactionCount(deployerAddr);
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", count);

    console.log(SECTION_SEPARATOR);

    const CallWhiteListFactory = await ethers.getContractFactory("CallWhitelist");
    const whitelist = <CallWhitelist>await CallWhiteListFactory.deploy({ nonce: count });
    await whitelist.deployed();

    const whitelistAddress = whitelist.address;
    console.log("CallWhiteList deployed to:", whitelistAddress);
    console.log(SUBSECTION_SEPARATOR);

    count++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", count);
    const AssetVaultFactory = await ethers.getContractFactory("AssetVault");
    const assetVault = <AssetVault>await AssetVaultFactory.deploy({ nonce: count });
    await assetVault.deployed();

    const assetVaultAddress = assetVault.address;
    console.log("AssetVault deployed to:", assetVaultAddress);
    console.log(SUBSECTION_SEPARATOR);

    count++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", count);
    const VaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
    const vaultFactory = <VaultFactory>await upgrades.deployProxy(
        VaultFactoryFactory,
        [assetVault.address, whitelist.address],
        {
            kind: "uups",
            initializer: "initialize(address, address)",
        },
    );
    await vaultFactory.deployed();

    const vaultFactoryProxyAddress = vaultFactory.address;
    console.log("VaultFactory proxy deployed to:", vaultFactoryProxyAddress);
    console.log(SUBSECTION_SEPARATOR);

    count = await ethers.provider.getTransactionCount(deployerAddr);
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", count);
    const FeeControllerFactory = await ethers.getContractFactory("FeeController");
    const feeController = <FeeController>await FeeControllerFactory.deploy({ nonce: count });
    await feeController.deployed();

    const feeControllerAddress = feeController.address;
    console.log("FeeController deployed to: ", feeControllerAddress);
    console.log(SUBSECTION_SEPARATOR);

    count++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", count);
    const bNoteName = "Arcade.xyz BorrowerNote";
    const bNoteSymbol = "aBN";
    const PromissoryNoteFactory = await ethers.getContractFactory("PromissoryNote");
    const borrowerNote = <PromissoryNote>await PromissoryNoteFactory.deploy(bNoteName, bNoteSymbol, { nonce: count });
    await borrowerNote.deployed();

    const borrowerNoteAddress = borrowerNote.address;
    console.log("BorrowerNote deployed to:", borrowerNote.address);

    count++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", count);
    const lNoteName = "Arcade.xyz LenderNote";
    const lNoteSymbol = "aLN";
    const lenderNote = <PromissoryNote>await PromissoryNoteFactory.deploy(lNoteName, lNoteSymbol, { nonce: count });
    await lenderNote.deployed();

    const lenderNoteAddress = lenderNote.address;
    console.log("LenderNote deployed to:", lenderNoteAddress);
    console.log(SUBSECTION_SEPARATOR);

    count++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", count);
    const LoanCoreFactory = await ethers.getContractFactory("LoanCore");
    const loanCore = <LoanCore>await upgrades.deployProxy(
        LoanCoreFactory,
        [feeController.address, borrowerNote.address, lenderNote.address],
        {
            kind: "uups",
        },
    );
    await loanCore.deployed();

    const loanCoreProxyAddress = loanCore.address;
    console.log("LoanCore proxy deployed to:", loanCoreProxyAddress);
    console.log(SUBSECTION_SEPARATOR);

    count = await ethers.provider.getTransactionCount(deployerAddr);
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", count);
    const RepaymentControllerFactory = await ethers.getContractFactory("RepaymentController");
    const repaymentController = <RepaymentController>(
        await RepaymentControllerFactory.deploy(loanCore.address)
    );
    await repaymentController.deployed();

    const repaymentContAddress = repaymentController.address;
    console.log("RepaymentController deployed to:", repaymentContAddress);

    console.log(SUBSECTION_SEPARATOR);

    count++;
    const OriginationControllerFactory = await ethers.getContractFactory("OriginationController");
    const originationController = <OriginationController>(
        await upgrades.deployProxy(OriginationControllerFactory, [loanCore.address], { kind: "uups" })
    );
    await originationController.deployed();

    const originationContProxyAddress = originationController.address;
    console.log("OriginationController proxy deployed to:", originationContProxyAddress);

    console.log(SUBSECTION_SEPARATOR);

    console.log("Writing to deployments json file...");
    await writeJson(
        assetVaultAddress,
        feeControllerAddress,
        borrowerNoteAddress,
        lenderNoteAddress,
        repaymentContAddress,
        whitelistAddress,
        vaultFactoryProxyAddress,
        loanCoreProxyAddress,
        originationContProxyAddress,
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
