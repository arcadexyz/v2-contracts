import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { SECTION_SEPARATOR } from "./bootstrap-tools";

import {
    ORIGINATOR_ROLE as DEFAULT_ORIGINATOR_ROLE,
    ADMIN_ROLE as DEFAULT_ADMIN_ROLE,
    FEE_CLAIMER_ROLE as DEFAULT_FEE_CLAIMER_ROLE,
    REPAYER_ROLE as DEFAULT_REPAYER_ROLE,
} from "./constants";

export async function main(
    signers: SignerWithAddress[],
    factory: Contract,
    originationController: Contract,
    borrowerNote: Contract,
    repaymentContoller: Contract,
    lenderNote: Contract,
    loanCore: Contract,
    feeController: Contract,
    whitelist: Contract,
    punkRouter: Contract,
    ADMIN_ROLE = DEFAULT_ADMIN_ROLE,
    FEE_CLAIMER_ROLE = DEFAULT_FEE_CLAIMER_ROLE,
    ORIGINATOR_ROLE = DEFAULT_ORIGINATOR_ROLE,
    REPAYER_ROLE = DEFAULT_REPAYER_ROLE,
): Promise<void> {
    signers = await ethers.getSigners();
    const [admin, adminMultiSig] = signers;
    const deployer = admin;

    const ADMIN_ADDRESS = admin.address;
    const VAULT_FACTORY_ADDRESS = factory.address;
    const LENDER_NOTE_ADDRESS = lenderNote.address;
    const BORROWER_NOTE_ADDRESS = borrowerNote.address;
    const ORIGINATION_CONTROLLER_ADDRESS = originationController.address;
    const LOAN_CORE_ADDRESS = loanCore.address;
    const FEE_CONTROLLER_ADDRESS = feeController.address;
    const REPAYMENT_CONTROLLER_ADDRESS = repaymentContoller.address;
    const CALL_WHITELIST_ADDRESS = whitelist.address;
    const PUNK_ROUTER_ADDRESS = punkRouter.address;

    if (!LOAN_CORE_ADDRESS) {
        throw new Error("Must specify LOAN_CORE_ADDRESS in environment!");
    }

    if (!admin.address) {
        throw new Error("Must specify ADMIN_ADDRESS in environment!");
    }

    if (FEE_CONTROLLER_ADDRESS) {
        console.log("Fee controller address:", FEE_CONTROLLER_ADDRESS);
    }

    console.log(SECTION_SEPARATOR);

    loanCore = await ethers.getContractAt("LoanCore", LOAN_CORE_ADDRESS);
    factory = await ethers.getContractAt("VaultFactory", VAULT_FACTORY_ADDRESS);
    lenderNote = await ethers.getContractAt("PromissoryNote", LENDER_NOTE_ADDRESS);
    borrowerNote = await ethers.getContractAt("PromissoryNote", BORROWER_NOTE_ADDRESS);

    // grant correct permissions for promissory note
    // giving to user to call PromissoryNote functions directly
    for (const note of [borrowerNote, lenderNote]) {
        await note.connect(admin).initialize(loanCore.address);
    }

    // grant LoanCore admin fee claimer permissions
    const updateLoanCoreFeeClaimer = await loanCore.connect(admin).grantRole(FEE_CLAIMER_ROLE, ADMIN_ADDRESS);
    await updateLoanCoreFeeClaimer.wait();

    console.log(`loanCore has granted fee claimer role: ${FEE_CLAIMER_ROLE} to address: ${ADMIN_ADDRESS}`);

    // grant LoanCore the admin role to enable authorizeUpgrade onlyRole(DEFAULT_ADMIN_ROLE)
    const updateLoanCoreAdmin = await loanCore.connect(admin).grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await updateLoanCoreAdmin.wait();

    console.log(`loanCore has granted admin role: ${ADMIN_ROLE} to address: ${ADMIN_ADDRESS}`);

    // grant VaultFactory the admin role to enable authorizeUpgrade onlyRole(DEFAULT_ADMIN_ROLE)
    const updateVaultFactoryAdmin = await factory.connect(admin).grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await updateVaultFactoryAdmin.wait();

    console.log(`vaultFactory has granted admin role: ${ADMIN_ROLE} to address: ${ADMIN_ADDRESS}`);

    // grant originationContoller the owner role to enable authorizeUpgrade onlyOwner
    const updateOriginationControllerAdmin = await loanCore.connect(admin).grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await updateOriginationControllerAdmin.wait();

    console.log(`originationController has granted admin role: ${ADMIN_ROLE} to address: ${ADMIN_ADDRESS}`);

    // grant originationContoller the originator role
    const updateOriginationControllerRole = await loanCore
        .connect(admin)
        .grantRole(ORIGINATOR_ROLE, ORIGINATION_CONTROLLER_ADDRESS);
    await updateOriginationControllerRole.wait();

    console.log(
        `originationController has granted originator role: ${ORIGINATOR_ROLE} to address: ${ORIGINATION_CONTROLLER_ADDRESS}`,
    );

    // grant repaymentContoller the REPAYER_ROLE
    const updateRepaymentControllerAdmin = await loanCore
        .connect(admin)
        .grantRole(REPAYER_ROLE, REPAYMENT_CONTROLLER_ADDRESS);
    await updateRepaymentControllerAdmin.wait();

    console.log(`loanCore has granted repayer role: ${REPAYER_ROLE} to address: ${REPAYMENT_CONTROLLER_ADDRESS}`);
    console.log(SECTION_SEPARATOR);

    // renounce ownership from deployer
    const renounceAdmin = await loanCore.connect(admin).renounceRole(ADMIN_ROLE, await deployer.getAddress());
    await renounceAdmin.wait();

    console.log(`loanCore has renounced admin role.`);

    const renounceOriginationControllerAdmin = await loanCore
        .connect(admin)
        .renounceRole(ADMIN_ROLE, await deployer.getAddress());
    await renounceOriginationControllerAdmin.wait();

    console.log(`originationController has renounced originator role.`);

    const renounceVaultFactoryAdmin = await factory
        .connect(admin)
        .renounceRole(ADMIN_ROLE, await deployer.getAddress());
    await renounceVaultFactoryAdmin.wait();

    console.log(`vaultFactory has renounced admin role.`);
    console.log(SECTION_SEPARATOR);

    if (FEE_CONTROLLER_ADDRESS) {
        // set FeeController admin
        const feeController = await ethers.getContractAt("FeeController", FEE_CONTROLLER_ADDRESS);
        const updateFeeControllerAdmin = await feeController.transferOwnership(adminMultiSig.address);
        await updateFeeControllerAdmin.wait();
    }

    console.log(`feeController has transferred ownership to address: ${adminMultiSig.address}`);

    if (CALL_WHITELIST_ADDRESS) {
        // set CallWhiteList admin
        const whitelist = await ethers.getContractAt("CallWhitelist", CALL_WHITELIST_ADDRESS);
        const updateWhitelistAdmin = await whitelist.transferOwnership(adminMultiSig.address);
        await updateWhitelistAdmin.wait();
    }

    console.log(`whitelist has transferred ownership to address: ${adminMultiSig.address}`);

    if (PUNK_ROUTER_ADDRESS) {
        // set PunkRouter admin
        const punkRouter = await ethers.getContractAt("PunkRouter", PUNK_ROUTER_ADDRESS);
        const updatepunkRouterAdmin = await punkRouter.transferOwnership(adminMultiSig.address);
        await updatepunkRouterAdmin.wait();
    }

    console.log(`punkRouter has transferred ownership to address: ${adminMultiSig.address}`);
    console.log(SECTION_SEPARATOR);
    console.log("Transferred all ownership.\n");
}
