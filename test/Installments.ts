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

const SECTION_SEPARATOR = "\n" + "=".repeat(80) + "\n";

const ORIGINATOR_ROLE = "0x59abfac6520ec36a6556b2a4dd949cc40007459bcd5cd2507f1e5cc77b6bc97e";
const REPAYER_ROLE = "0x9c60024347074fd9de2c1e36003080d22dbc76a41ef87444d21e361bcb39118e";

//interest rate parameters
const INTEREST_DENOMINATOR = ethers.utils.parseEther("1"); //1*10**18
const BASIS_POINTS_DENOMINATOR = BigNumber.from(10000);

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

/**
 * Sets up a test asset vault for the user passed as an arg
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
 * Sets up a test context, deploying new contracts and returning them for use in a test
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
 * Create a NON-INSTALLMENT LoanTerms object using the given parameters, or defaults
 */
const createLoanTerms = (
    payableCurrency: string,
    collateralAddress: string,
    {
        durationSecs = 3600000,
        principal = hre.ethers.utils.parseEther("100"),
        interest = hre.ethers.utils.parseEther("1"),
        collateralId = BigNumber.from(1),
        numInstallments = 0,
    }: Partial<LoanTerms> = {},
): LoanTerms => {
    return {
        durationSecs,
        principal,
        interest,
        collateralAddress,
        collateralId,
        payableCurrency,
        numInstallments,
    };
};

/**
 * Create an INSTALLMENT LoanTerms object using the given parameters
 */
const createInstallmentLoanTerms = (
    payableCurrency: string,
    durationSecs: number,
    principal: BigNumber,
    interest: BigNumber,
    collateralAddress: string,
    numInstallments: number,
    { collateralId = BigNumber.from(1) }: Partial<LoanTerms> = {},
): LoanTerms => {
    return {
        durationSecs,
        principal,
        interest,
        collateralAddress,
        collateralId,
        payableCurrency,
        numInstallments,
    };
};

/**
 * Initialize a loan WITHOUT installments
 */
interface LoanDef {
    loanId: string;
    bundleId: BigNumber;
    loanTerms: LoanTerms;
    loanData: LoanData;
}

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
    interest: BigNumber,
    numInstallments: number,
    terms?: Partial<LoanTerms>,
): Promise<LoanDef> => {
    const { originationController, mockERC20, vaultFactory, loanCore, lender, borrower } = context;
    const bundleId = await initializeBundle(vaultFactory, borrower);
    const loanTerms = createInstallmentLoanTerms(
        payableCurrency,
        durationSecs,
        principal,
        interest,
        vaultFactory.address,
        numInstallments,
        { collateralId: bundleId },
    );
    if (terms) Object.assign(loanTerms, terms);
    await mint(mockERC20, lender, loanTerms.principal);
    await mint(mockERC20, borrower, ethers.utils.parseEther("10000")); // for when they need additional liquidity ( lot of payments missed)

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

describe("Installment Period Testing", () => {
    it("Try to create an installment loan with an odd number (1) of installment payments.", async () => {
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
        ).to.be.revertedWith("LoanCore::create: Number of installments must be an even number");
    });

    it("Try to create an installment loan with an odd number(11) of installment payments.", async () => {
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
        ).to.be.revertedWith("LoanCore::create: Number of installments must be an even number");
    });

    it("Create an installment loan with 4 installments periods and a loan duration of 36000. Static Call getInstallmentMinPayment to verify number of numMissedPayments is equal to zero.", async () => {
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

        // min amount due
        //console.log(ethers.utils.formatEther(res[0]+'') + "ETH");
        //expect(ethers.utils.formatEther(res[0]+'')).to.equal("2.5");

        // num payment missed
        //console.log(res[2].toNumber());
        expect(res[2].toNumber()).to.equal(0);
    });

    it("Create an installment loan with 8 installments periods and a loan duration of 100000.Fast Forward to 2nd installment period. Static Call getInstallmentMinPayment to verify number of numMissedPayments is equal to one.", async () => {
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
        //console.log(res)

        // min amount due
        //console.log(ethers.utils.formatEther(res[0]+'') + "ETH");
        //expect(ethers.utils.formatEther(res[0]+'')).to.equal("2.5");

        // num payment missed
        //console.log(res[2].toNumber());
        expect(res[2].toNumber()).to.equal(1);
    });

    it("Create an installment loan with 8 installments periods and a loan duration of 100000. Fast Forward to 5th installment period. Static Call getInstallmentMinPayment to verify number of numMissedPayments is equal to four.", async () => {
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
        //console.log(res)

        // min amount due
        //console.log(ethers.utils.formatEther(res[0]+'') + "ETH");
        //expect(ethers.utils.formatEther(res[0]+'')).to.equal("2.5");

        // num payment missed (current installment period minus 1, if no payments have been made)
        //console.log(res[2].toNumber());
        expect(res[2].toNumber()).to.equal(4);
    });

    it("Create an installment loan with 10 installments periods and a loan duration of 1 year. Fast Forward to 6th installment period. Static Call getInstallmentMinPayment to verify number of numMissedPayments is equal to five.", async () => {
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

        //increase one installment period
        await blockchainTime.increaseTime((86400 * 365) / 2);

        const res = await repaymentController
            .connect(borrower)
            .callStatic.getInstallmentMinPayment(loanData.borrowerNoteId);
        //console.log(res)

        // min amount due
        //console.log(ethers.utils.formatEther(res[0]+'') + "ETH");
        //expect(ethers.utils.formatEther(res[0]+'')).to.equal("2.5");

        // num payment missed (current installment period minus 1, if no payments have been made)
        //console.log(res[2].toNumber());
        expect(res[2].toNumber()).to.equal(5);
    });
});

describe("Installment Repayments", () => {
    it("Tries to create installment loan type with 0 installments.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, vaultFactory, loanCore } = context;
        const { loanData, bundleId, loanTerms } = await initializeLoan(context);

        await mint(mockERC20, borrower, loanTerms.principal.add(loanTerms.interest));
        await mockERC20
            .connect(borrower)
            .approve(repaymentController.address, loanTerms.principal.add(loanTerms.interest));
        expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);

        await expect(
            repaymentController.connect(borrower).getInstallmentMinPayment(loanData.borrowerNoteId),
        ).to.be.revertedWith("This loan type does not have any installments.");
    });

    it("Create an installment loan with 4 installments periods and a loan duration of 36000. Call repayPart to pay the minimum on the first installment period.", async () => {
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

        //const bal = await mockERC20.connect(borrower).balanceOf(borrower.address);
        //console.log("Borrower's balance before repaying installment (ETH): ", ethers.utils.formatEther(bal));
        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.50"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            mockERC20,
            "Transfer",
        );
    });

    it("Create an installment loan with 4 installments periods and a loan duration of 36000. Call repayPart to pay the minimum on the first installment period. With Allowance set to less than amount due. Should Revert.", async () => {
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

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("2.49"));
        //await repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId);
        await expect(
            repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId),
        ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    });
    it("Create an installment loan with 4 installments periods and a loan duration of 36000. Skip the first period, then call repayPart. Pay the minimum balance due with late fees. ", async () => {
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
        //increase one installment period
        await blockchainTime.increaseTime(36000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("3.0125"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            mockERC20,
            "Transfer",
        );
    });

    it("Create an installment loan with 4 installments periods and a loan duration of 36000. Skip the first two instalment periods, then call repayPart. Pay the minimum balance due with late fees. ", async () => {
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
        //increase two installment period
        await blockchainTime.increaseTime(36000 / 4 + 36000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("6.1128125"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            mockERC20,
            "Transfer",
        );
    });

    it("Create an installment loan with 4 installments periods and a loan duration of 36000. Skip the first two instalment periods, then call repayPart. Pay the minimum balance due with late fees. Should revert with insufficient allowance sent. ", async () => {
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
        //increase two installment period
        await blockchainTime.increaseTime(36000 / 4 + 36000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("6.1128124"));
        await expect(
            repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId),
        ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    });

    it("Create an installment loan with 4 installments periods and a loan duration of 36000. Skip the first three instalment periods, then call repayPart. Pay the minimum balance due with late fees. Should revert with insufficient allowance sent. ", async () => {
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
        //increase three installment period
        await blockchainTime.increaseTime(36000 / 4 + 36000 / 4 + 36000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("9.3784453125"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            mockERC20,
            "Transfer",
        );
    });

    it("Create an installment loan with 4 installments periods and a loan duration of 36000. Skip the first three instalment periods, then call repayPart. Pay the minimum balance due with late fees. Should revert with insufficient allowance sent. ", async () => {
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
        //increase three installment period
        await blockchainTime.increaseTime(36000 / 4 + 36000 / 4 + 36000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("9.3784453124"));
        await expect(
            repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId),
        ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    });

    it("Should return installment period and number of installments missed when relative current time is outside loan duration. This case is 1 period overdue. ", async () => {
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
        //increase 4 installment periods
        await blockchainTime.increaseTime(36000 + 36000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("16.74"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            mockERC20,
            "Transfer",
        );
    });

    it("Should return installment period and number of installments missed when relative current time is outside loan duration. This case is 1 period overdue. ", async () => {
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
        //increase 4 installment periods
        await blockchainTime.increaseTime(36000 + 36000);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("31.31"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            mockERC20,
            "Transfer",
        );
    });

    it("Should return installment period and number of installments missed when relative current time is outside loan duration. This case is 4 periods overdue. ", async () => {
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
        //increase 4 installment periods
        await blockchainTime.increaseTime(36000 + 36000);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("31.30"));
        await expect(
            repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId),
        ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
    });

    it("Should return installment period and number of installments missed when relative current time is outside loan duration. This case is 4 periods overdue. ", async () => {
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
        //increase 4 installment periods
        await blockchainTime.increaseTime(36000 * 10);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("5393"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            mockERC20,
            "Transfer",
        );
    });

    it("Create an installment loan with 8 installments periods and a loan duration of 36000. Call repayPart to pay the minimum on the first installment period.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower } = context;
        const { loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            36000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            8, // numInstallments
        );

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("1.25"));
        await expect(repaymentController.connect(borrower).repayPartMinimum(loanData.borrowerNoteId)).to.emit(
            mockERC20,
            "Transfer",
        );
    });

    it("Create an installment loan with 8 installments periods and a loan duration of 36000. Call repayPart to pay the minimum on the first two installment payments.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, borrower, blockchainTime } = context;
        const { loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            36000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            8, // numInstallments
        );

        //const bal = await mockERC20.connect(borrower).balanceOf(borrower.address);
        //console.log("Borrower's balance before repaying installment (ETH): ", ethers.utils.formatEther(bal));
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
    });

    it("Create an installment loan with 4 installments periods and a loan duration of 36000. Call repayPart to pay the minimum plus 1/4 the principal for four consecutive on time payments.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, loanCore, borrower, blockchainTime } = context;
        const { loanId, loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            36000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            4, // numInstallments
        );

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("27.5"));
        await expect(
            repaymentController.connect(borrower).repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("27.5")),
        ).to.emit(mockERC20, "Transfer");

        await blockchainTime.increaseTime(36000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("26.875"));
        await expect(
            repaymentController.connect(borrower).repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("26.875")),
        ).to.emit(mockERC20, "Transfer");
        await blockchainTime.increaseTime(36000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("26.25"));
        await expect(
            repaymentController.connect(borrower).repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("26.25")),
        ).to.emit(mockERC20, "Transfer");
        await blockchainTime.increaseTime(36000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("25.625"));
        await expect(
            repaymentController.connect(borrower).repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("25.625")),
        ).to.emit(mockERC20, "Transfer");

        const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
        expect(loanDATA.balance).to.equal(0);
        expect(loanDATA.state).to.equal(LoanState.Repaid);
        expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("106.25"));
    });

    it("Create an installment loan with 8 installments periods and a loan duration of 72000. Call repayPart to pay the minimum plus 1/4 the principal for four payments every other installment period.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, loanCore, borrower, blockchainTime } = context;
        const { loanId, loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            72000, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            8, // numInstallments
        );

        await blockchainTime.increaseTime(72000 / 8);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("25"));
        await expect(
            repaymentController.connect(borrower).repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("25")),
        ).to.emit(mockERC20, "Transfer");
        await blockchainTime.increaseTime(72000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("25"));
        await expect(
            repaymentController.connect(borrower).repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("25")),
        ).to.emit(mockERC20, "Transfer");
        await blockchainTime.increaseTime(72000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("25"));
        await expect(
            repaymentController.connect(borrower).repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("25")),
        ).to.emit(mockERC20, "Transfer");
        await blockchainTime.increaseTime(72000 / 4);

        await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther("29.5469"));
        await expect(
            repaymentController
                .connect(borrower)
                .repayPart(loanData.borrowerNoteId, ethers.utils.parseEther("29.5469")),
        ).to.emit(mockERC20, "Transfer");

        const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
        expect(loanDATA.balance).to.equal(0);
        expect(loanDATA.state).to.equal(LoanState.Repaid);
        expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("104.5469"));
    });

    it("Create an installment loan with 12 installments periods and a loan duration of 1 year. Call repayPart to pay the minimum on time, for 24 payments to see the if the principal has changed.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, loanCore, borrower, blockchainTime } = context;
        const { loanId, loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            31536000, // durationSecs
            hre.ethers.utils.parseEther("1000"), // principal
            hre.ethers.utils.parseEther("625"), // interest
            12, // numInstallments
        );

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

            await blockchainTime.increaseTime(31536000 / 12);
        }

        const loanDATA = await loanCore.connect(borrower).getLoan(loanId);
        expect(loanDATA.balance).to.equal(ethers.utils.parseEther("1000"));
        expect(loanDATA.state).to.equal(LoanState.Active);
        expect(loanDATA.balancePaid).to.equal(ethers.utils.parseEther("62.4999996"));
    });

    it("Create an installment loan with 24 installments periods and a loan duration of 2 years. Call repayPart to pay the minimum on time, for 24 payments to see the if the principal has changed.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, mockERC20, loanCore, borrower, blockchainTime } = context;
        const { loanId, loanData } = await initializeInstallmentLoan(
            context,
            mockERC20.address,
            31536000 * 2, // durationSecs
            hre.ethers.utils.parseEther("1000"), // principal
            hre.ethers.utils.parseEther("75"), // interest
            24, // numInstallments
        );

        //increase time barely, so getInstallmentMinPayment fn call does not occur in the same block
        await blockchainTime.increaseTime(1);

        for (let i = 0; i < 24; i++) {
            await mockERC20.connect(borrower).approve(repaymentController.address, ethers.utils.parseEther(".3125"));
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
    });
});
