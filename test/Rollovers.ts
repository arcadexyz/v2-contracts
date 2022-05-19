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
        durationSecs: BigNumberish,
        principal: BigNumber,
        interestRate: BigNumber,
        numInstallments: BigNumberish,
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

        const DEADLINE = 1754884800;

        beforeEach(async () => {
            ctx = await loadFixture(fixture);
            loan = await initializeLoan(
                ctx,
                ctx.mockERC20.address,
                BigNumber.from(86400),
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                2, // numInstallments
                DEADLINE
            );
        });

        it("should not allow a rollover if the collateral doesn't match", async () => {
            const { originationController, vaultFactory, borrower, lender } = ctx;
            const { loanId, loanTerms, bundleId } = loan;

            // create new terms for rollover and sign them
            const newTerms = createLoanTerms(
                ctx.mockERC20.address,
                vaultFactory.address,
                { ...loanTerms, collateralId: BigNumber.from(bundleId).add(1) } // different bundle ID
            );

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                lender,
                "2",
                2
            );

            await expect(
                originationController.connect(borrower).rolloverLoan(
                    loanId,
                    newTerms,
                    lender.address,
                    sig,
                    2
                )
            ).to.be.revertedWith("OC_RolloverCollateralMismatch");
        });

        it("should not allow a rollover if the loan currencies don't match", async () => {
            const { originationController, vaultFactory, borrower, lender, admin } = ctx;
            const { loanId, loanTerms } = loan;

            const otherERC20 = <MockERC20>await deploy("MockERC20", admin, ["Mock ERC20", "MOCK"]);

            // create new terms for rollover and sign them
            const newTerms = createLoanTerms(
                otherERC20.address,      // different currency
                vaultFactory.address,
                loanTerms
            );

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                lender,
                "2",
                2
            );

            await expect(
                originationController.connect(borrower).rolloverLoan(
                    loanId,
                    newTerms,
                    lender.address,
                    sig,
                    2
                )
            ).to.be.revertedWith("OC_RolloverCurrencyMismatch");
        });

        it("should not allow a rollover on an already closed loan", async () => {
            const {
                originationController,
                repaymentController,
                mockERC20,
                vaultFactory,
                borrower,
                lender,
                admin
            } = ctx;
            const { loanId, loanTerms } = loan;

            // Repay the loan
            await mockERC20.connect(admin).mint(borrower.address, ethers.utils.parseEther("1000"));
            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("1000"));
            await repaymentController.connect(borrower).closeLoan(loanId);

            // create new terms for rollover and sign them
            const newTerms = createLoanTerms(
                mockERC20.address,
                vaultFactory.address,
                loanTerms
            );

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                lender,
                "2",
                2
            );

            await expect(
                originationController.connect(borrower).rolloverLoan(
                    loanId,
                    newTerms,
                    lender.address,
                    sig,
                    2
                )
            ).to.be.revertedWith("OC_InvalidState");
        });

        it("should not allow a rollover if called by a third party", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                lender,
                newLender,
            } = ctx;
            const { loanId, loanTerms } = loan;

            // create new terms for rollover and sign them
            const newTerms = createLoanTerms(
                mockERC20.address,
                vaultFactory.address,
                loanTerms
            );

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                lender,
                "2",
                2
            );

            await expect(
                // newLender not a counterparty
                originationController.connect(newLender).rolloverLoan(
                    loanId,
                    newTerms,
                    lender.address,
                    sig,
                    2
                )
            ).to.be.revertedWith("OC_CallerNotParticipant");
        });

        it("should not allow a rollover if signed by the old lender", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                borrower,
                lender,
                newLender,
            } = ctx;
            const { loanId, loanTerms } = loan;

            // create new terms for rollover and sign them
            const newTerms = createLoanTerms(
                mockERC20.address,
                vaultFactory.address,
                loanTerms
            );

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                lender,
                "2",
                2
            );

            await expect(
                // newLender not a counterparty
                originationController.connect(borrower).rolloverLoan(
                    loanId,
                    newTerms,
                    newLender.address,
                    sig,
                    2
                )
            ).to.be.revertedWith("OC_InvalidSignature");
        });

        it("should not allow a rollover if called by the old lender", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                lender,
                newLender,
            } = ctx;
            const { loanId, loanTerms } = loan;

            // create new terms for rollover and sign them
            const newTerms = createLoanTerms(
                mockERC20.address,
                vaultFactory.address,
                loanTerms
            );

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                newLender,
                "2",
                2
            );

            await expect(
                // newLender not a counterparty
                originationController.connect(lender).rolloverLoan(
                    loanId,
                    newTerms,
                    newLender.address,
                    sig,
                    2
                )
            ).to.be.revertedWith("OC_CallerNotParticipant");
        });

        it("should roll over to the same lender", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                borrower,
                lender,
            } = ctx;
            const { loanId, loanTerms } = loan;

            // create new terms for rollover and sign them
            const newTerms = createLoanTerms(
                mockERC20.address,
                vaultFactory.address,
                loanTerms
            );

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                lender,
                "2",
                2
            );

            // Figure out amounts owed
            // With same terms, borrower will have to pay interest plus 2%
            // 10% interest on 100, plus 12% eq 12

            await mockERC20.mint(borrower.address, ethers.utils.parseEther("12"));
            await mockERC20.connect(borrower).approve(originationController.address, ethers.utils.parseEther("12"));

            await originationController.connect(borrower).rolloverLoan(
                loanId,
                newTerms,
                lender.address,
                sig,
                2
            );

            // Check repayment controller balance 0
            // Check loan core balance 0.6 (og fee + rollover fee)

            // await expect(
            //     // newLender not a counterparty
            //     originationController.connect(borrower).rolloverLoan(
            //         loanId,
            //         newTerms,
            //         lender.address,
            //         sig,
            //         2
            //     )
            // ).to.not.be.reverted;
        });

        it("should roll over to a different lender");
        it("should roll over to a different lender, called by the lender");
        it("should roll over to a different lender using an items signature");
        it("should roll over to the same lender using an items signature");
        it("should roll over an installment loan to a different lender");
        it("should roll over an installment loan to the same lender");
    });

});
