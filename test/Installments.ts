import { expect } from "chai";
import hre, { ethers, waffle } from "hardhat";
const { loadFixture } = waffle;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber } from "ethers";
import {
    OriginationController,
    PromissoryNote,
    RepaymentController,
    LoanCore,
    MockERC20,
    MockERC721,
    AssetVault,
    CallWhitelist,
    VaultFactory,
    FeeController,
} from "../typechain";
import { BlockchainTime } from "./utils/time";
import { deploy } from "./utils/contracts";
import { approve, mint } from "./utils/erc20";
import { LoanTerms, LoanData, LoanState } from "./utils/types";
import { createLoanTermsSignature } from "./utils/eip712";

const ORIGINATOR_ROLE = "0x59abfac6520ec36a6556b2a4dd949cc40007459bcd5cd2507f1e5cc77b6bc97e";
const REPAYER_ROLE = "0x9c60024347074fd9de2c1e36003080d22dbc76a41ef87444d21e361bcb39118e";

interface TestContext {
    loanCore: LoanCore;
    mockERC20: MockERC20;
    mockERC721: MockERC721;
    borrowerNote: PromissoryNote;
    lenderNote: PromissoryNote;
    vaultFactory: VaultFactory;
    repaymentController: RepaymentController;
    originationController: OriginationController;
    borrower: SignerWithAddress;
    lender: SignerWithAddress;
    admin: SignerWithAddress;
    currentTimestamp: number;
    blockchainTime: BlockchainTime;
}

interface LoanDef {
    loanId: string;
    bundleId: BigNumber;
    loanTerms: LoanTerms;
    loanData: LoanData;
}

// TODO:
// 1. Tests with really small principal values < 10000 wei.
// 2. Remove modulus(2) require statement and try a 1 installment loan.

/**
 * Set up a test asset vault for the user passed as a parameter
 */
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

/**
 * Set up a test context, deploying new contracts and returning them for use in tests
 */
const fixture = async (): Promise<TestContext> => {
    const blockchainTime = new BlockchainTime();
    const currentTimestamp = await blockchainTime.secondsFromNow(0);

    const signers: SignerWithAddress[] = await hre.ethers.getSigners();
    const [borrower, lender, admin] = signers;

    const whitelist = <CallWhitelist>await deploy("CallWhitelist", admin, []);
    const vaultTemplate = <AssetVault>await deploy("AssetVault", admin, []);
    const vaultFactory = <VaultFactory>(
        await deploy("VaultFactory", signers[0], [vaultTemplate.address, whitelist.address])
    );

    const feeController = <FeeController>await deploy("FeeController", admin, []);
    const loanCore = <LoanCore>await deploy("LoanCore", admin, [feeController.address]);

    const mockERC20 = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);
    const mockERC721 = <MockERC721>await deploy("MockERC721", signers[0], ["Mock ERC721", "MOCK"]);

    const originationController = <OriginationController>(
        await deploy("OriginationController", signers[0], [loanCore.address])
    );
    await originationController.deployed();

    const borrowerNoteAddress = await loanCore.borrowerNote();
    const borrowerNote = <PromissoryNote>(
        (await ethers.getContractFactory("PromissoryNote")).attach(borrowerNoteAddress)
    );

    const lenderNoteAddress = await loanCore.lenderNote();
    const lenderNote = <PromissoryNote>(await ethers.getContractFactory("PromissoryNote")).attach(lenderNoteAddress);
    const repaymentController = <RepaymentController>(
        await deploy("RepaymentController", admin, [loanCore.address, borrowerNoteAddress, lenderNoteAddress])
    );
    await repaymentController.deployed();
    const updateRepaymentControllerPermissions = await loanCore.grantRole(REPAYER_ROLE, repaymentController.address);
    await updateRepaymentControllerPermissions.wait();

    const updateOriginationControllerPermissions = await loanCore.grantRole(
        ORIGINATOR_ROLE,
        originationController.address,
    );
    await updateOriginationControllerPermissions.wait();

    return {
        loanCore,
        borrowerNote,
        lenderNote,
        repaymentController,
        originationController,
        mockERC20,
        mockERC721,
        vaultFactory,
        borrower,
        lender,
        admin,
        currentTimestamp,
        blockchainTime,
    };
};

/**
 * Create a NON-INSTALLMENT loan using the given parameters, or defaults
 */
const createLoanTerms = (
    payableCurrency: string,
    collateralAddress: string,
    {
        durationSecs = 3600000,
        principal = hre.ethers.utils.parseEther("100"),
        interestRate = hre.ethers.utils.parseEther("1"),
        collateralId = BigNumber.from(1),
        numInstallments = 0,
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
    };
};

/**
 * Create an INSTALLMENT loan using the given parameters, or default
 */
const createInstallmentLoanTerms = (
    payableCurrency: string,
    durationSecs: number,
    principal: BigNumber,
    interestRate: BigNumber,
    collateralAddress: string,
    numInstallments: number,
    { collateralId = BigNumber.from(1) }: Partial<LoanTerms> = {},
): LoanTerms => {
    return {
        durationSecs,
        principal,
        interestRate,
        collateralAddress,
        collateralId,
        payableCurrency,
        numInstallments,
    };
};

/**
 * Initialize a loan WITHOUT installments
 */
const initializeLoan = async (context: TestContext): Promise<LoanDef> => {
    const { originationController, mockERC20, vaultFactory, loanCore, lender, borrower } = context;
    const bundleId = await initializeBundle(vaultFactory, borrower);
    const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
    await mint(mockERC20, lender, loanTerms.principal);

    const sig = await createLoanTermsSignature(
        originationController.address,
        "OriginationController",
        loanTerms,
        borrower,
        "2",
    );

    await approve(mockERC20, lender, originationController.address, loanTerms.principal);
    await vaultFactory.connect(borrower).approve(originationController.address, bundleId);

    const tx = await originationController
        .connect(lender)
        .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig);
    const receipt = await tx.wait();

    let loanId;
    if (receipt && receipt.events && receipt.events.length == 15) {
        const LoanCreatedLog = new hre.ethers.utils.Interface([
            "event LoanStarted(uint256 loanId, address lender, address borrower)",
        ]);
        const log = LoanCreatedLog.parseLog(receipt.events[14]);
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

/**
 * Initialize a loan WITH installments
 */
const initializeInstallmentLoan = async (
    context: TestContext,
    payableCurrency: string,
    durationSecs: number,
    principal: BigNumber,
    interestRate: BigNumber,
    numInstallments: number,
    terms?: Partial<LoanTerms>,
): Promise<LoanDef> => {
    const { originationController, mockERC20, vaultFactory, loanCore, lender, borrower } = context;
    const bundleId = await initializeBundle(vaultFactory, borrower);
    const loanTerms = createInstallmentLoanTerms(
        payableCurrency,
        durationSecs,
        principal,
        interestRate,
        vaultFactory.address,
        numInstallments,
        { collateralId: bundleId },
    );
    if (terms) Object.assign(loanTerms, terms);
    await mint(mockERC20, lender, loanTerms.principal);
    // for when borrower needs additional liquidity (lot of payments missed)
    await mint(mockERC20, borrower, ethers.utils.parseEther("10000"));

    const sig = await createLoanTermsSignature(
        originationController.address,
        "OriginationController",
        loanTerms,
        borrower,
        "2",
    );

    await approve(mockERC20, lender, originationController.address, loanTerms.principal);
    await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
    const tx = await originationController
        .connect(lender)
        .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig);
    const receipt = await tx.wait();

    let loanId;
    if (receipt && receipt.events && receipt.events.length == 15) {
        const LoanCreatedLog = new hre.ethers.utils.Interface([
            "event LoanStarted(uint256 loanId, address lender, address borrower)",
        ]);
        const log = LoanCreatedLog.parseLog(receipt.events[14]);
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

// ======================= INSTALLMENTS TESTS =======================

describe("Installment Period", () => {
    it("Create a loan with an odd number (1) of installment payments. Should revert.", async () => {
        const context = await loadFixture(fixture);
        const { mockERC20 } = context;
        await expect(
            initializeInstallmentLoan(
                context,
                mockERC20.address,
                86400, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                1, // numInstallments
            ),
        ).to.be.revertedWith("LoanCore::create: Even num of installments and must be < 1000000");
    });

    it("Create a loan with an odd number (11) of installment payments. Should revert.", async () => {
        const context = await loadFixture(fixture);
        const { mockERC20 } = context;
        await expect(
            initializeInstallmentLoan(
                context,
                mockERC20.address,
                86400 * 11, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                11, // numInstallments
            ),
        ).to.be.revertedWith("LoanCore::create: Even num of installments and must be < 1000000");
    });

    it("Verify missed payments equals zero.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, blockchainTime } = context;
        const { loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            36000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            4, // numInstallments
        );

        //increase time barely, so getInstallmentMinPayment fn call does not occur in the same block
        await blockchainTime.increaseTime(1);

        const res = await repaymentController
            .connect(borrower)
            .callStatic.getInstallmentMinPayment(loanData.borrowerNoteId);
        const minInterestDue = res[1];
        const lateFees = res[2];
        const numMissedPayments = res[3].toNumber();
        expect(minInterestDue).to.equal(ethers.utils.parseEther("2.5"));
        expect(lateFees).to.equal(ethers.utils.parseEther("0"));
        expect(numMissedPayments).to.equal(0);
    });

    it("Fast Forward to 2nd period. Verify missed payments equals one.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, blockchainTime } = context;
        const { loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            100000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            8, // numInstallments
        );

        //increase one installment period
        await blockchainTime.increaseTime(100000 / 8);

        const res = await repaymentController
            .connect(borrower)
            .callStatic.getInstallmentMinPayment(loanData.borrowerNoteId);
        const minInterestDue = res[1];
        const lateFees = res[2];
        const numMissedPayments = res[3].toNumber();
        expect(minInterestDue).to.equal(ethers.utils.parseEther("2.521875"));
        expect(lateFees).to.equal(ethers.utils.parseEther("0.5"));
        expect(numMissedPayments).to.equal(1);
    });

    it("Fast Forward to 5th period. Verify missed payments equals four.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, blockchainTime } = context;
        const { loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            100000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            8, // numInstallments
        );

        //increase one installment period
        await blockchainTime.increaseTime(100000 / 8 + 100000 / 8 + 100000 / 8 + 100000 / 8);

        const res = await repaymentController
            .connect(borrower)
            .callStatic.getInstallmentMinPayment(loanData.borrowerNoteId);
        const minInterestDue = res[1];
        const lateFees = res[2];
        const numMissedPayments = res[3].toNumber();
        expect(minInterestDue).to.equal(ethers.utils.parseEther("6.536242480517578125"));
        expect(lateFees).to.equal(ethers.utils.parseEther("2.063202679687500000"));
        expect(numMissedPayments).to.equal(4);
    });

    it("Fast Forward to 6th period. Verify missed payments equals five.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, blockchainTime } = context;
        const { loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            86400 * 365, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            10, // numInstallments
        );

        //increase two installment periods
        await blockchainTime.increaseTime((86400 * 365) / 2);

        const res = await repaymentController
            .connect(borrower)
            .callStatic.getInstallmentMinPayment(loanData.borrowerNoteId);
        const minInterestDue = res[1];
        const lateFees = res[2];
        const numMissedPayments = res[3].toNumber();
        expect(minInterestDue).to.equal(ethers.utils.parseEther("6.331972372009375"));
        expect(lateFees).to.equal(ethers.utils.parseEther("2.6015226503125"));
        expect(numMissedPayments).to.equal(5);
    });

    it("Pay first installment then miss 2 payments. Verify missed payments equals two.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, blockchainTime, loanCore } = context;
        const { loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            36000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            4, // numInstallments
        );
        // pay first installment
        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("3"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            loanCore,
            "InstallmentPaymentReceived",
        );
        //increase three installment periods
        await blockchainTime.increaseTime(36000 / 4 + 36000 / 4 + 36000 / 4);

        const res = await repaymentController
            .connect(borrower)
            .callStatic.getInstallmentMinPayment(loanData.borrowerNoteId);
        const minInterestDue = res[1];
        const lateFees = res[2];
        const numMissedPayments = res[3].toNumber();
        expect(minInterestDue).to.equal(ethers.utils.parseEther("7.73975"));
        expect(lateFees).to.equal(ethers.utils.parseEther("1.015"));
        expect(numMissedPayments).to.equal(2);
    });

    it("Miss first installment, pay second, then miss 4 payments. Verify missed payments equals four.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, blockchainTime, loanCore } = context;
        const { loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            36000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            8, // numInstallments
        );

        await blockchainTime.increaseTime(36000 / 8 + 10);

        // pay first installment
        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("3.021875"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            loanCore,
            "InstallmentPaymentReceived",
        );
        //increase four installment periods
        await blockchainTime.increaseTime(36000 / 8 + 36000 / 8 + 36000 / 8 + 36000 / 8 + 36000 / 8);

        const res = await repaymentController
            .connect(borrower)
            .callStatic.getInstallmentMinPayment(loanData.borrowerNoteId);
        const minInterestDue = res[1];
        const lateFees = res[2];
        const numMissedPayments = res[3].toNumber();
        expect(minInterestDue).to.equal(ethers.utils.parseEther("6.536242480517578125"));
        expect(lateFees).to.equal(ethers.utils.parseEther("2.0632026796875"));
        expect(numMissedPayments).to.equal(4);
    });
});

describe("Installment Repayments", () => {
    it("Scenario: numInstallments: 0", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, vaultFactory, loanCore } = context;
        const { loanData, bundleId, loanTerms } = await initializeLoan(context);

        await mint(mockERC20, borrower, loanTerms.principal.add(loanTerms.interestRate));
        await mockERC20
            .connect(borrower)
            .approve(repaymentController.address, loanTerms.principal.add(loanTerms.interestRate));
        expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);

        await expect(
            repaymentController.connect(borrower).getInstallmentMinPayment(loanData.borrowerNoteId),
        ).to.be.revertedWith("RepaymentCont::minPayment: Loan does not have any installments");
    });

    it("Scenario: numInstallments: 8, durationSecs: 36000 principal: 100, interest: 10%. Repay minimum on first payment.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, lender, blockchainTime, loanCore } = context;
        const { loanData, loanId } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            36000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            8, // numInstallments
        );
        const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
        const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

        //increase time barely
        await blockchainTime.increaseTime(10);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("1.25"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            mockERC20,
            "Transfer",
        );

        const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
        expect(loanDATA.balance).to.equal(ethers.utils.parseEther("100"));
        expect(loanDATA.state).to.equal(LoanState.Active);
        expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("1.25"));

        const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
        const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
        await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("1.25")));
        await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("1.25")));
    });

    it("Scenario: numInstallments: 4, durationSecs: 36000 principal: 100, interest: 10%. Repay minimum on first payment.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, lender, loanCore, blockchainTime } = context;
        const { loanData, loanId } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            36000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            4, // numInstallments
        );
        const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
        const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

        //increase time barely
        await blockchainTime.increaseTime(10);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.5"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            loanCore,
            "InstallmentPaymentReceived",
        );

        const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
        expect(loanDATA.balance).to.equal(ethers.utils.parseEther("100"));
        expect(loanDATA.state).to.equal(LoanState.Active);
        expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("2.5"));

        const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
        const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
        await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("2.5")));
        await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("2.5")));
    });

    it("Scenario: numInstallments: 4, durationSecs: 36000 principal: 100, interest: 10%. Pay the minimum with insufficient allowance Should Revert.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower } = context;
        const { loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            36000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            4, // numInstallments
        );
        const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.49"));
        await expect(
            repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId),
        ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

        await expect(await mockERC20.balanceOf(await borrower.getAddress())).to.equal(borrowerBalanceBefore);
    });

    describe("Late Payments", () => {
        it("Scenario: numInstallments: 4, durationSecs: 36000 principal: 100, interest: 10%. Make repayment after one skipped payment. ", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, blockchainTime, lender, loanCore } = context;
            const { loanData, loanId } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());
            // increase one installment period
            await blockchainTime.increaseTime(36000 / 4 + 10);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("5.575"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("100"));
            expect(loanDATA.state).to.equal(LoanState.Active);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("5.575"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("5.575")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("5.575")));
        });

        it("Scenario: numInstallments: 4, durationSecs: 36000 principal: 100, interest: 10%. Make repayment after two skipped payments.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, blockchainTime, loanCore } = context;
            const { loanData, loanId } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());
            //increase two installment period
            await blockchainTime.increaseTime(36000 / 4 + 36000 / 4);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("8.75475"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("100"));
            expect(loanDATA.state).to.equal(LoanState.Active);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("8.75475"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("8.75475")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("8.75475")));
        });

        it("Scenario: numInstallments: 4, durationSecs: 36000 principal: 100, interest: 10%. Pay the minimum with insufficient allowance Should Revert.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, blockchainTime } = context;
            const { loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            //increase two installment period
            await blockchainTime.increaseTime(36000 / 4 + 36000 / 4);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("8.75474"));
            await expect(
                repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId),
            ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });

        it("Scenario: numInstallments: 4, durationSecs: 36000 principal: 100, interest: 10%. Make repayment after three skipped payments.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, blockchainTime, loanCore } = context;
            const { loanData, loanId } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            //increase three installment period
            await blockchainTime.increaseTime(36000 / 4 + 36000 / 4 + 36000 / 4);

            await mockERC20
                .connect(borrower)
                .approve(repaymentController.address, ethers.utils.parseEther("12.0577675"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("100"));
            expect(loanDATA.state).to.equal(LoanState.Active);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("12.0577675"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(
                borrowerBalanceBefore.sub(ethers.utils.parseEther("12.0577675")),
            );
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("12.0577675")));
        });

        describe("After Loan Duration Payments", () => {
            it("Repay minimum after missing loan duration and 1 additional period.", async () => {
                const context = await loadFixture(fixture);
                const { repaymentController, mockERC20, borrower, lender, blockchainTime, loanCore } = context;
                const { loanData, loanId } = await initializeInstallmentLoan(
                    context,
                    mockERC20.address,
                    36000, // durationSecs
                    hre.ethers.utils.parseEther("100"), // principal
                    hre.ethers.utils.parseEther("1000"), // interest
                    4, // numInstallments
                );
                const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
                const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

                //increase 4 installment periods
                await blockchainTime.increaseTime(36000 + 36000 / 4);

                await mockERC20
                    .connect(borrower)
                    .approve(repaymentController.address, ethers.utils.parseEther("19.11319634075"));
                await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                    mockERC20,
                    "Transfer",
                );

                const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
                expect(loanDATA.balance).to.equal(ethers.utils.parseEther("100"));
                expect(loanDATA.state).to.equal(LoanState.Active);
                expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("19.11319634075"));

                const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
                const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
                await expect(borrowerBalanceAfter).to.equal(
                    borrowerBalanceBefore.sub(ethers.utils.parseEther("19.11319634075")),
                );
                await expect(lenderBalanceAfter).to.equal(
                    lenderBalanceBefore.add(ethers.utils.parseEther("19.11319634075")),
                );
            });

            it("Repay minimum after missing loan duration and 1 additional period, with insufficient allowance Should Revert.", async () => {
                const context = await loadFixture(fixture);
                const { repaymentController, mockERC20, borrower, blockchainTime } = context;
                const { loanData } = await initializeInstallmentLoan(
                    context,
                    mockERC20.address,
                    36000, // durationSecs
                    hre.ethers.utils.parseEther("100"), // principal
                    hre.ethers.utils.parseEther("1000"), // interest
                    4, // numInstallments
                );
                const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());

                //increase 4 installment periods
                await blockchainTime.increaseTime(36000 + 36000 / 4);

                await mockERC20
                    .connect(borrower)
                    .approve(repaymentController.address, ethers.utils.parseEther("19.11319634074"));
                await expect(
                    repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId),
                ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");

                await expect(await mockERC20.balanceOf(await borrower.getAddress())).to.equal(borrowerBalanceBefore);
            });

            it("Repay minimum after skipping whole loan duration x 2.", async () => {
                const context = await loadFixture(fixture);
                const { repaymentController, mockERC20, borrower, lender, blockchainTime, loanCore } = context;
                const { loanData, loanId } = await initializeInstallmentLoan(
                    context,
                    mockERC20.address,
                    36000, // durationSecs
                    hre.ethers.utils.parseEther("100"), // principal
                    hre.ethers.utils.parseEther("1000"), // interest
                    4, // numInstallments
                );
                const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
                const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

                //increase 4 installment periods
                await blockchainTime.increaseTime(36000 + 36000);

                await mockERC20
                    .connect(borrower)
                    .approve(repaymentController.address, ethers.utils.parseEther("31.15279066794581275"));
                await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                    mockERC20,
                    "Transfer",
                );

                const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
                expect(loanDATA.balance).to.equal(ethers.utils.parseEther("100"));
                expect(loanDATA.state).to.equal(LoanState.Active);
                expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("31.15279066794581275"));

                const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
                const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
                await expect(borrowerBalanceAfter).to.equal(
                    borrowerBalanceBefore.sub(ethers.utils.parseEther("31.15279066794581275")),
                );
                await expect(lenderBalanceAfter).to.equal(
                    lenderBalanceBefore.add(ethers.utils.parseEther("31.15279066794581275")),
                );
            });

            it("Repay minimum after skipping whole loan duration x 10.", async () => {
                const context = await loadFixture(fixture);
                const { repaymentController, mockERC20, borrower, lender, blockchainTime, loanCore } = context;
                const { loanData, loanId } = await initializeInstallmentLoan(
                    context,
                    mockERC20.address,
                    36000, // durationSecs
                    hre.ethers.utils.parseEther("100"), // principal
                    hre.ethers.utils.parseEther("1000"), // interest
                    4, // numInstallments
                );
                const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
                const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

                //increase 4 installment periods
                await blockchainTime.increaseTime(36000 * 10);

                await mockERC20
                    .connect(borrower)
                    .approve(repaymentController.address, ethers.utils.parseEther("630.929509200042118676"));
                await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                    mockERC20,
                    "Transfer",
                );

                const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
                expect(loanDATA.balance).to.equal(ethers.utils.parseEther("100"));
                expect(loanDATA.state).to.equal(LoanState.Active);
                expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("630.929509200042118676"));

                const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
                const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
                await expect(borrowerBalanceAfter).to.equal(
                    borrowerBalanceBefore.sub(ethers.utils.parseEther("630.929509200042118676")),
                );
                await expect(lenderBalanceAfter).to.equal(
                    lenderBalanceBefore.add(ethers.utils.parseEther("630.929509200042118676")),
                );
            });
        });
    });

    describe("Multiple Repayments", () => {
        it("Scenario: numInstallments: 8, durationSecs: 36000, principal: 100, interest: 10%. Repay minimum on first two repayments.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, blockchainTime, loanCore } = context;
            const { loanData, loanId } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                8, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("1.25"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            await blockchainTime.increaseTime(36000 / 8);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("1.25"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("100"));
            expect(loanDATA.state).to.equal(LoanState.Active);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("2.5"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("2.5")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("2.5")));
        });

        it("Scenario: numInstallments: 4, durationSecs: 36000, principal: 100, interest: 10%. Repay the minimum interest plus 1/4 the principal for four consecutive payments.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, loanCore, borrower, lender, blockchainTime } = context;
            const { loanId, loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());
            // increase time slightly
            await blockchainTime.increaseTime(10);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("27.5"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("27.5")),
            ).to.emit(mockERC20, "Transfer");

            await blockchainTime.increaseTime(36000 / 4);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("26.875"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("26.875")),
            ).to.emit(mockERC20, "Transfer");

            await blockchainTime.increaseTime(36000 / 4);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("26.25"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("26.25")),
            ).to.emit(loanCore, "InstallmentPaymentReceived");

            await blockchainTime.increaseTime(36000 / 4);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("25.625"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("25.625")),
            ).to.emit(loanCore, "LoanRepaid");

            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(0);
            expect(loanDATA.state).to.equal(LoanState.Repaid);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("106.25"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("106.25")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("106.25")));
        });

        it("Scenario: numInstallments: 8, durationSecs: 72000, principal: 100, interest: 10%. Repay the minimum plus 1/4 the principal for four payments every other payment period.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, loanCore, borrower, lender, blockchainTime } = context;
            const { loanId, loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                72000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                8, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            // increase to the second installment period
            await blockchainTime.increaseTime(72000 / 8 + 100);

            // 3.021875ETH + 25ETH
            await mockERC20
                .connect(borrower)
                .approve(repaymentController.address, ethers.utils.parseEther("28.021875"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("28.021875")),
            ).to.emit(mockERC20, "Transfer");
            // increase to the fourth installment
            await blockchainTime.increaseTime(72000 / 4);
            // 1.34313ETH + 25ETH
            await mockERC20
                .connect(borrower)
                .approve(repaymentController.address, ethers.utils.parseEther("27.26640625"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("27.26640625")),
            ).to.emit(mockERC20, "Transfer");
            // increase to the sixth installment period
            await blockchainTime.increaseTime(72000 / 4);

            // 0.92913ETH + 25ETH
            await mockERC20
                .connect(borrower)
                .approve(repaymentController.address, ethers.utils.parseEther("26.5109375"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("26.5109375")),
            ).to.emit(mockERC20, "Transfer");
            // increase to the last installment period
            await blockchainTime.increaseTime(72000 / 4);

            // 0.43601ETH + 25ETH
            await mockERC20
                .connect(borrower)
                .approve(repaymentController.address, ethers.utils.parseEther("25.75546875"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("25.75546875")),
            ).to.emit(loanCore, "LoanRepaid");

            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(0);
            expect(loanDATA.state).to.equal(LoanState.Repaid);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("107.5546875"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(
                borrowerBalanceBefore.sub(ethers.utils.parseEther("107.5546875")),
            );
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("107.5546875")));
        });

        it("Scenario: numInstallments: 12, durationSecs: 1y, principal: 1000, interest: 6.25%. Repay minimum on 12 payments to see the if the principal has changed.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, loanCore, borrower, lender, blockchainTime } = context;
            const { loanId, loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                31536000, // durationSecs
                hre.ethers.utils.parseEther("1000"), // principal
                hre.ethers.utils.parseEther("625"), // interest
                12, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            //increase time barely, so getInstallmentMinPayment fn call does not occur in the same block
            await blockchainTime.increaseTime(1);

            for (let i = 0; i < 12; i++) {
                await mockERC20
                    .connect(borrower)
                    .approve(repaymentController.address, ethers.utils.parseEther("5.2083333"));
                await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                    mockERC20,
                    "Transfer",
                );
                // increase to the next installment period
                await blockchainTime.increaseTime(31536000 / 12);
            }

            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("1000"));
            expect(loanDATA.state).to.equal(LoanState.Active);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("62.4999996"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(
                borrowerBalanceBefore.sub(ethers.utils.parseEther("62.4999996")),
            );
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("62.4999996")));
        });

        it("Scenario: numInstallments: 12, durationSecs: 1y, principal: 100000, interest: 10.00%. Repay min interest and monthly principal x 12.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, loanCore, borrower, lender, blockchainTime } = context;
            const { loanId, loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                31536000, // durationSecs
                hre.ethers.utils.parseEther("100000"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                12, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            //increase time barely, so getInstallmentMinPayment fn call does not occur in the same block
            await blockchainTime.increaseTime(1);

            for (let i = 0; i < 12; i++) {
                await mockERC20
                    .connect(borrower)
                    .approve(repaymentController.address, ethers.utils.parseEther("8791.599")); // first and maximum repayment
                await expect(
                    repaymentController
                        .connect(borrower)
                        .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("8791.599")),
                ).to.emit(mockERC20, "Transfer");
                //increase one installment period
                await blockchainTime.increaseTime(31536000 / 12);
            }

            // verify loanData after 12 txs on time
            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("0"));
            expect(loanDATA.state).to.equal(LoanState.Repaid);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("105499.058840292240863275"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(
                borrowerBalanceBefore.sub(ethers.utils.parseEther("105499.058840292240863275")),
            );
            await expect(lenderBalanceAfter).to.equal(
                lenderBalanceBefore.add(ethers.utils.parseEther("105499.058840292240863275")),
            );
        });

        it("Scenario: numInstallments: 4, durationSecs: 1y, principal: 100, interest: 10.00%. Repay min interest and monthly principal x 4.", async () => {
            const context = await loadFixture(fixture);
            const {
                repaymentController,
                originationController,
                mockERC20,
                loanCore,
                borrower,
                lender,
                blockchainTime,
            } = context;
            const { loanId, loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                31536000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            // increase time barely, so getInstallmentMinPayment fn call does not occur in the same block
            await blockchainTime.increaseTime(1);

            for (let i = 0; i < 4; i++) {
                await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("27.5")); // first and maximum repayment
                await expect(
                    repaymentController
                        .connect(borrower)
                        .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("27.5")),
                ).to.emit(mockERC20, "Transfer");
                // increase one installment period
                await blockchainTime.increaseTime(31536000 / 4);
            }

            // verify loanData after 4 txs on time
            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("0"));
            expect(loanDATA.state).to.equal(LoanState.Repaid);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("106.187109375"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(
                borrowerBalanceBefore.sub(ethers.utils.parseEther("106.187109375")),
            );
            await expect(lenderBalanceAfter).to.equal(
                lenderBalanceBefore.add(ethers.utils.parseEther("106.187109375")),
            );
        });

        it("Repay everything with repayPart after paying 2 minimum payments (in second installment period).", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, loanCore, blockchainTime } = context;
            const { loanId, loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            //increase time slightly
            await blockchainTime.increaseTime(10);

            //repay minimum
            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.5"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            //increase time
            await blockchainTime.increaseTime(36000 / 4);
            //repay minimum
            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.5"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            //increase time slightly, but still same installment period
            await blockchainTime.increaseTime(1);
            // repay entire principal to close the loan
            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("100"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("100")),
            ).to.emit(loanCore, "LoanRepaid");

            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("0"));
            expect(loanDATA.state).to.equal(LoanState.Repaid);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("105"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("105")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("105")));
        });

        it("Scenario: numInstallments: 4, durationSecs: 1y principal: 100, interest: 10.00%. Repay min interest x 1 and 1/4 principal, then pay off rest of loan.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, loanCore, borrower, lender, blockchainTime } = context;
            const { loanId, loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                31536000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            //increase time barely, so getInstallmentMinPayment fn call does not occur in the same block
            await blockchainTime.increaseTime(1);

            // 1st payment
            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("27.5")); // first and maximum repayment
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("27.5")),
            ).to.emit(mockERC20, "Transfer");

            // increase one installment period
            await blockchainTime.increaseTime(31536000 / 4);

            // second payment
            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("76.875")); // first and maximum repayment
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("76.875")),
            ).to.emit(loanCore, "LoanRepaid");

            // verify loanData after 4 txs on time
            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("0"));
            expect(loanDATA.state).to.equal(LoanState.Repaid);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("104.375"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("104.375")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("104.375")));
        });

        it("Scenario: numInstallments: 24, durationSecs: 2y principal: 1000, interest: 0.75%. Repay minimum on 24 payments to see the if the principal has changed.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, loanCore, borrower, lender, blockchainTime } = context;
            const { loanId, loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                31536000 * 2, // durationSecs
                hre.ethers.utils.parseEther("1000"), // principal
                hre.ethers.utils.parseEther("75"), // interest
                24, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            //increase time barely, so getInstallmentMinPayment fn call does not occur in the same block
            await blockchainTime.increaseTime(1);

            for (let i = 0; i < 24; i++) {
                await mockERC20
                    .connect(borrower)
                    .approve(repaymentController.address, ethers.utils.parseEther(".3125"));
                await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                    mockERC20,
                    "Transfer",
                );

                await blockchainTime.increaseTime((31536000 * 2) / 24);
            }

            const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
            expect(loanDATA.balance).to.equal(ethers.utils.parseEther("1000"));
            expect(loanDATA.state).to.equal(LoanState.Active);
            expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("7.5"));

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("7.5")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("7.5")));
        });
    });

    describe("Close Loan", () => {
        it("Close loan in first installment period.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, blockchainTime } = context;
            const { loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            //increase time slightly
            await blockchainTime.increaseTime(10);

            const res = await repaymentController
                .connect(borrower)
                .callStatic.amountToCloseLoan(loanData.borrowerNoteId);
            const amountDue = res[0];
            const numMissedPayments = res[1].toNumber();
            expect(amountDue).to.equal(ethers.utils.parseEther("102.5"));
            expect(numMissedPayments).to.equal(0);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("102.5"));
            await expect(repaymentController.connect(borrower).closeLoan(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("102.5")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("102.5")));
        });

        it("Close loan in first installment period, but set allowance to less than required. Should revert.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, blockchainTime } = context;
            const { loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());

            //increase time slightly
            await blockchainTime.increaseTime(10);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("102.4"));
            await expect(repaymentController.connect(borrower).closeLoan(loanData.borrowerNoteId)).to.be.revertedWith(
                "ERC20: transfer amount exceeds allowance",
            );

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            await expect(borrowerBalanceAfter).to.equal(ethers.utils.parseEther("10097"));
        });

        it("Close loan in last installment period.", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, blockchainTime } = context;
            const { loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            //increase time slightly
            await blockchainTime.increaseTime(36000 - 100);

            const res = await repaymentController
                .connect(borrower)
                .callStatic.amountToCloseLoan(loanData.borrowerNoteId);
            const amountDue = res[0];
            const numMissedPayments = res[1].toNumber();
            expect(amountDue).to.equal(ethers.utils.parseEther("112.0577675"));
            expect(numMissedPayments).to.equal(3);

            await mockERC20
                .connect(borrower)
                .approve(repaymentController.address, ethers.utils.parseEther("112.0577675"));
            await expect(repaymentController.connect(borrower).closeLoan(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(
                borrowerBalanceBefore.sub(ethers.utils.parseEther("112.0577675")),
            );
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("112.0577675")));
        });

        it("Close loan after paying 2 minimum payments (in third installment period).", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, blockchainTime } = context;
            const { loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());

            // increase time slightly, first installment period
            await blockchainTime.increaseTime(10);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.5"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            // increase time, second period
            await blockchainTime.increaseTime(36000 / 4);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.5"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            // increase time, third period
            await blockchainTime.increaseTime(36000 / 4);

            //  pay off rest of the loan
            const res = await repaymentController
                .connect(borrower)
                .callStatic.amountToCloseLoan(loanData.borrowerNoteId);
            const amountDue = res[0];
            const numMissedPayments = res[1].toNumber();
            expect(amountDue).to.equal(ethers.utils.parseEther("102.5"));
            expect(numMissedPayments).to.equal(0);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("102.5"));
            await expect(repaymentController.connect(borrower).closeLoan(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("107.5")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("107.5")));
        });

        it("Close loan after paying 2 minimum payments (in second installment period).", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, blockchainTime } = context;
            const { loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());
            //increase time slightly
            await blockchainTime.increaseTime(10);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.5"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            //increase time
            await blockchainTime.increaseTime(36000 / 4);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.5"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            //increase time slightly, but still same installment period
            await blockchainTime.increaseTime(1);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("100"));
            await expect(repaymentController.connect(borrower).closeLoan(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("105")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("105")));
        });

        it("Close loan after paying 1 minimum payment, 1 repayPart for half the principal (in second installment period).", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower, lender, blockchainTime } = context;
            const { loanData } = await initializeInstallmentLoan(
                context,
                mockERC20.address,
                36000, // durationSecs
                hre.ethers.utils.parseEther("100"), // principal
                hre.ethers.utils.parseEther("1000"), // interest
                4, // numInstallments
            );
            const borrowerBalanceBefore = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceBefore = await mockERC20.balanceOf(await lender.getAddress());
            //increase time slightly
            await blockchainTime.increaseTime(10);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.5"));
            await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            //increase time
            await blockchainTime.increaseTime(36000 / 4);

            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("52.5"));
            await expect(
                repaymentController
                    .connect(borrower)
                    .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("52.5")),
            ).to.emit(mockERC20, "Transfer");

            //increase time slightly, but still same installment period
            await blockchainTime.increaseTime(1);
            //  pay off rest of the loan
            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("50"));
            await expect(repaymentController.connect(borrower).closeLoan(loanData.borrowerNoteId)).to.emit(
                mockERC20,
                "Transfer",
            );

            const borrowerBalanceAfter = await mockERC20.balanceOf(await borrower.getAddress());
            const lenderBalanceAfter = await mockERC20.balanceOf(await lender.getAddress());
            await expect(borrowerBalanceAfter).to.equal(borrowerBalanceBefore.sub(ethers.utils.parseEther("105")));
            await expect(lenderBalanceAfter).to.equal(lenderBalanceBefore.add(ethers.utils.parseEther("105")));
        });
    });
});
