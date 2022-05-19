import { expect } from "chai";
import hre, { ethers, waffle, upgrades } from "hardhat";
const { loadFixture } = waffle;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber, BigNumberish } from "ethers";

import {
    VaultFactory,
    CallWhitelist,
    AssetVault,
    AssetVault__factory,
    FeeController,
    OriginationController,
    PromissoryNote,
    RepaymentController,
    LoanCore,
    MockERC20,
} from "../typechain";
import { BlockchainTime } from "./utils/time";
import { deploy } from "./utils/contracts";
import { approve, mint } from "./utils/erc20";
import { LoanTerms, LoanData } from "./utils/types";
import { createLoanTermsSignature } from "./utils/eip712";

const ORIGINATOR_ROLE = "0x59abfac6520ec36a6556b2a4dd949cc40007459bcd5cd2507f1e5cc77b6bc97e";
const REPAYER_ROLE = "0x9c60024347074fd9de2c1e36003080d22dbc76a41ef87444d21e361bcb39118e";

interface TestContext {
    loanCore: LoanCore;
    mockERC20: MockERC20;
    borrowerNote: PromissoryNote;
    lenderNote: PromissoryNote;
    vaultFactory: VaultFactory;
    repaymentController: RepaymentController;
    originationController: OriginationController;
    borrower: SignerWithAddress;
    lender: SignerWithAddress;
    admin: SignerWithAddress;
    newLender: SignerWithAddress;
    currentTimestamp: number;
    blockchainTime: BlockchainTime;
}

interface LoanDef {
    loanId: string;
    bundleId: BigNumberish;
    loanTerms: LoanTerms;
    loanData: LoanData;
}

describe("Rollovers", () => {
    const blockchainTime = new BlockchainTime();

    /**
     * Sets up a test context, deploying new contracts and returning them for use in a test
     */
    const fixture = async (): Promise<TestContext> => {
        const blockchainTime = new BlockchainTime();
        const currentTimestamp = await blockchainTime.secondsFromNow(0);

        const signers: SignerWithAddress[] = await hre.ethers.getSigners();
        const [borrower, lender, admin, newLender] = signers;

        const whitelist = <CallWhitelist>await deploy("CallWhitelist", signers[0], []);
        const vaultTemplate = <AssetVault>await deploy("AssetVault", signers[0], []);
        const VaultFactoryFactory = await hre.ethers.getContractFactory("VaultFactory");
        const vaultFactory = <VaultFactory>(await upgrades.deployProxy(VaultFactoryFactory, [vaultTemplate.address, whitelist.address], { kind: 'uups' })
        );
        const feeController = <FeeController>await deploy("FeeController", admin, []);

        const borrowerNote = <PromissoryNote>await deploy("PromissoryNote", admin, ["Arcade.xyz BorrowerNote", "aBN"]);
        const lenderNote = <PromissoryNote>await deploy("PromissoryNote", admin, ["Arcade.xyz LenderNote", "aLN"]);

        const LoanCore = await hre.ethers.getContractFactory("LoanCore");
        const loanCore = <LoanCore>(
            await upgrades.deployProxy(LoanCore, [feeController.address, borrowerNote.address, lenderNote.address], { kind: 'uups' })
        );

        // Grant correct permissions for promissory note
        for (const note of [borrowerNote, lenderNote]) {
            await note.connect(admin).initialize(loanCore.address);
        }

        const updateborrowerPermissions = await loanCore.grantRole(ORIGINATOR_ROLE, borrower.address);
        await updateborrowerPermissions.wait();

        const mockERC20 = <MockERC20>await deploy("MockERC20", admin, ["Mock ERC20", "MOCK"]);

        const repaymentController = <RepaymentController>(
            await deploy("RepaymentController", admin, [loanCore.address, borrowerNote.address, lenderNote.address])
        );
        await repaymentController.deployed();
        const updateRepaymentControllerPermissions = await loanCore.grantRole(
            REPAYER_ROLE,
            repaymentController.address,
        );
        await updateRepaymentControllerPermissions.wait();

        const OriginationController = await hre.ethers.getContractFactory("OriginationController");
        const originationController = <OriginationController>(
            await upgrades.deployProxy(OriginationController, [loanCore.address], { kind: 'uups' })
        );
        await originationController.deployed();
        const updateOriginationControllerPermissions = await loanCore.grantRole(
            ORIGINATOR_ROLE,
            originationController.address,
        );
        await updateOriginationControllerPermissions.wait();

        return {
            loanCore,
            borrowerNote,
            lenderNote,
            vaultFactory,
            repaymentController,
            originationController,
            mockERC20,
            borrower,
            lender,
            admin,
            newLender,
            currentTimestamp,
            blockchainTime
        };
    };

    /**
     * Create a LoanTerms object using the given parameters, or defaults
     */
    const createLoanTerms = (
        payableCurrency: string,
        collateralAddress: string,
        {
            durationSecs = BigNumber.from(3600000),
            principal = hre.ethers.utils.parseEther("100"),
            interestRate = hre.ethers.utils.parseEther("1"),
            collateralId = 1,
            numInstallments = 0,
            deadline = 1754884800,
        }: Partial<LoanTerms> = {},
    ): LoanTerms => {
        return {
            durationSecs,
            principal,
            interestRate,
            collateralAddress,
            collateralId,
            payableCurrency,
            numInstallments,
            deadline
        };
    };

    const initializeBundle = async (vaultFactory: VaultFactory, user: SignerWithAddress): Promise<BigNumber> => {
        const tx = await vaultFactory.connect(user).initializeBundle(await user.getAddress());
        const receipt = await tx.wait();

        if (receipt && receipt.events) {
            for (const event of receipt.events) {
                if (event.event && event.event === "VaultCreated" && event.args && event.args.vault) {
                    return event.args.vault;
                }
            }
            throw new Error("Unable to initialize bundle");
        } else {
            throw new Error("Unable to initialize bundle");
        }
    };

    const initializeLoan = async (
        context: TestContext,
        payableCurrency: string,
        durationSecs: BigNumber,
        principal: BigNumber,
        interestRate: BigNumber,
        numInstallments: number,
        deadline: BigNumberish,
    ): Promise<LoanDef> => {
        const { originationController, mockERC20, vaultFactory, loanCore, lender, borrower } = context;
        const bundleId = await initializeBundle(vaultFactory, borrower);
        const loanTerms = createLoanTerms(
            payableCurrency,
            vaultFactory.address,
            {
                durationSecs,
                principal,
                interestRate,
                numInstallments,
                deadline,
                collateralId: bundleId,
            }
        );

        await mint(mockERC20, lender, loanTerms.principal);

        const sig = await createLoanTermsSignature(
            originationController.address,
            "OriginationController",
            loanTerms,
            borrower,
            "2",
            BigNumber.from(1)
        );

        await approve(mockERC20, lender, originationController.address, loanTerms.principal);
        await vaultFactory.connect(borrower).approve(originationController.address, bundleId);

        const tx = await originationController
            .connect(lender)
            .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig, 1);
        const receipt = await tx.wait();

        let loanId;

        if (receipt && receipt.events) {
            const loanCreatedLog = new hre.ethers.utils.Interface([
                "event LoanStarted(uint256 loanId, address lender, address borrower)",
            ]);
            const log = loanCreatedLog.parseLog(receipt.events[receipt.events.length - 1]);
            loanId = log.args.loanId;
        } else {
            throw new Error("Unable to initialize loan");
        }

        return {
            loanId,
            bundleId,
            loanTerms,
            loanData: await loanCore.getLoan(loanId),
        };
    };


    describe("Rollover Loan",  () => {
        let ctx: TestContext;
        let loan: LoanDef;

        beforeEach(async () => {
            ctx = await loadFixture(fixture);
        });

        it("should not allow a rollover if the collateral doesn't match");
        it("should not allow a rollover if the loan currencies don't match");
        it("should not allow a rollover on an already closed loan");
        it("should not allow a rollover if called by a third party");
        it("should not allow a rollover if called by the old lender");
        it("should roll over to a different lender");
        it("should roll over to the same lender");
        it("should roll over to a different lender using an items signature");
        it("should roll over to the same lender using an items signature");
        it("should roll over an installment loan to a different lender");
        it("should roll over an installment loan to the same lender");
    });

});
