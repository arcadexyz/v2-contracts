import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { ORIGINATOR_ROLE as DEFAULT_ORIGINATOR_ROLE, ADMIN_ROLE as DEFAULT_ADMIN_ROLE, FEE_CLAIMER_ROLE as DEFAULT_FEE_CLAIMER_ROLE, REPAYER_ROLE as DEFAULT_REPAYER_ROLE } from "./constants";


export async function main (
    VAULT_FACTORY_ADDRESS = "0x3A54241cB7801BDea625565AAcb0e873e79C0649",
    LENDER_NOTE_ADDRESS = "0xdeaBbBe620EDF275F06E75E8fab18183389d606F",
    BORROWER_NOTE_ADDRESS = "0xaEF48370a5f37CFb760CE44E6cbF986C4DeFF389",
    ORIGINATION_CONTROLLER_ADDRESS = "0xFE046149bc8830d989A007E81A9D7F8A3b575F36",
    LOAN_CORE_ADDRESS = "0xd624D1879429A606f54F48B08b56126c3Fe70049",
    ADMIN_ADDRESS = "0x9b419fd36837558D8A3197a28a5e580AcE44f64F",
    FEE_CONTROLLER_ADDRESS = "0xE4a1917Ebe8fd2CAFD79799C82aDAa7E81AC6D47",
    REPAYMENT_CONTROLLER_ADDRESS = "0x23ce21bE3ebd1c86325100460D58d14a1D143E8d",
    CALL_WHITELIST_ADDRESS = "0x8a12BB999100846B9E56aba4906762353C416952",
    PUNK_ROUTER_ADDRESS= "0x76391cd8e269f2e8fDcf893E7F5E5781B2Fe2514",
    ADMIN_ROLE = DEFAULT_ADMIN_ROLE,
    FEE_CLAIMER_ROLE = DEFAULT_FEE_CLAIMER_ROLE,
    ORIGINATOR_ROLE = DEFAULT_ORIGINATOR_ROLE,
    REPAYER_ROLE = DEFAULT_REPAYER_ROLE
): Promise<void> {
    const signers: SignerWithAddress[] = await ethers.getSigners();
    const [admin, adminMultiSig] = signers;
    const deployer = admin;

    if (!LOAN_CORE_ADDRESS) {
        throw new Error("Must specify LOAN_CORE_ADDRESS in environment!");
    }

    if (!admin.address) {
        throw new Error("Must specify ADMIN_ADDRESS in environment!");
    }

    if (FEE_CONTROLLER_ADDRESS) {
        console.log("Fee controller address:", FEE_CONTROLLER_ADDRESS);
    }

    const loanCore = await ethers.getContractAt("LoanCore", LOAN_CORE_ADDRESS);
    const vaultFactory = await ethers.getContractAt("VaultFactory", VAULT_FACTORY_ADDRESS);
    const lenderNote = await ethers.getContractAt("PromissoryNote", LENDER_NOTE_ADDRESS);
    const borrowerNote = await ethers.getContractAt("PromissoryNote", BORROWER_NOTE_ADDRESS);

    // grant correct permissions for promissory note
    // giving to user to call PromissoryNote functions directly
    for (const note of [borrowerNote, lenderNote]) {
        await note.connect(await admin).initialize(loanCore.address);
    }

    // grant LoanCore admin fee claimer permissions
    const updateLoanCoreFeeClaimer = await loanCore.connect(admin).grantRole(FEE_CLAIMER_ROLE, ADMIN_ADDRESS);
    await updateLoanCoreFeeClaimer.wait();

    // grant LoanCore the admin role to enable authorizeUpgrade onlyRole(DEFAULT_ADMIN_ROLE)
    const updateLoanCoreAdmin = await loanCore.connect(admin).grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await updateLoanCoreAdmin.wait();

    // grant VaultFactory the admin role to enable authorizeUpgrade onlyRole(DEFAULT_ADMIN_ROLE)
    const updateVaultFactoryAdmin = await vaultFactory.connect(admin).grantRole(ADMIN_ROLE, ADMIN_ADDRESS);
    await updateVaultFactoryAdmin.wait();

    // grant originationContoller the owner role to enable authorizeUpgrade onlyOwner
    const updateOriginationControllerAdmin = await loanCore.connect(admin).grantRole(ORIGINATOR_ROLE, ORIGINATION_CONTROLLER_ADDRESS);
    await updateOriginationControllerAdmin.wait();

    // grant repaymentContoller the REPAYER_ROLE
    const updateRepaymentControllerAdmin = await loanCore.connect(admin).grantRole(REPAYER_ROLE, REPAYMENT_CONTROLLER_ADDRESS);
    await updateRepaymentControllerAdmin.wait();

    // renounce ownership from deployer
    const renounceAdmin = await loanCore.connect(admin).renounceRole(ADMIN_ROLE, await deployer.getAddress());
    await renounceAdmin.wait();

    const renounceOriginationControllerAdmin = await loanCore.connect(admin).renounceRole(ORIGINATOR_ROLE, await deployer.getAddress());
    await renounceOriginationControllerAdmin.wait();

    const renounceVaultFactoryAdmin = await vaultFactory.connect(admin).renounceRole(ADMIN_ROLE, await deployer.getAddress());
    await renounceVaultFactoryAdmin.wait();

    if (FEE_CONTROLLER_ADDRESS) {
        // set FeeController admin
        const feeController = await ethers.getContractAt("FeeController", FEE_CONTROLLER_ADDRESS);
        const updateFeeControllerAdmin = await feeController.transferOwnership(adminMultiSig.address);
        await updateFeeControllerAdmin.wait();
    }

    if (CALL_WHITELIST_ADDRESS) {
    // set CallWhiteList admin
    const whitelist = await ethers.getContractAt("CallWhitelist", CALL_WHITELIST_ADDRESS);
    const updateWhitelistAdmin = await whitelist.transferOwnership(adminMultiSig.address);
    await updateWhitelistAdmin.wait();
    }

    if (PUNK_ROUTER_ADDRESS) {
    // set PunkRouter admin
    const punkRouter = await ethers.getContractAt("PunkRouter", PUNK_ROUTER_ADDRESS);
    const updatepunkRouterAdmin = await punkRouter.transferOwnership(adminMultiSig.address);
    await updatepunkRouterAdmin.wait();
    }

    console.log("Transferred all ownership.\n");
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
