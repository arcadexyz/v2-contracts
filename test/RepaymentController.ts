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
 * Create a NON-INSTALLMENT LoanTerms object
 */
const createLoanTerms = (
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

const initializeLoan = async (
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
    const loanTerms = createLoanTerms(
        payableCurrency,
        durationSecs,
        principal,
        interest,
        vaultFactory.address,
        numInstallments,
        { collateralId: bundleId },
    );
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

describe("Legacy Repayments with interest parameter as a rate:", () => {
    it("Create legacy loan type (no installments) and repay interest. 100 ETH principal, 10% interest rate.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, vaultFactory, mockERC20, loanCore, borrower, lender } = context;
        const { loanId, loanTerms, loanData, bundleId } = await initializeLoan(
            context,
            mockERC20.address,
            86400, // durationSecs
            hre.ethers.utils.parseEther("100"), // principal
            hre.ethers.utils.parseEther("1000"), // interest
            0, // numInstallments
        );
        // total repayment amount
        const total = ethers.utils.parseEther("110");
        const repayAdditionalAmount = total.sub(await mockERC20.balanceOf(borrower.address));
        // mint borrower exactly enough to repay loan
        await mint(mockERC20, borrower, repayAdditionalAmount);
        await mockERC20.connect(borrower).approve(repaymentController.address, total);

        expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);

        await repaymentController.connect(borrower).repay(loanData.borrowerNoteId);

        expect(await mockERC20.balanceOf(borrower.address)).to.equal(0);
    });

    it("Create legacy loan type (no installments) and repay interest. 10 ETH principal, 7.5% interest rate.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, vaultFactory, mockERC20, loanCore, borrower, lender } = context;
        const { loanId, loanTerms, loanData, bundleId } = await initializeLoan(
            context,
            mockERC20.address,
            86400, // durationSecs
            hre.ethers.utils.parseEther("10"), // principal
            hre.ethers.utils.parseEther("750"), // interest
            0, // numInstallments
        );
        // total repayment amount
        const total = ethers.utils.parseEther("10.75");
        const repayAdditionalAmount = total.sub(await mockERC20.balanceOf(borrower.address));
        // mint borrower exactly enough to repay loan
        await mint(mockERC20, borrower, repayAdditionalAmount);
        await mockERC20.connect(borrower).approve(repaymentController.address, total);

        expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);

        await repaymentController.connect(borrower).repay(loanData.borrowerNoteId);

        expect(await mockERC20.balanceOf(borrower.address)).to.equal(0);
    });

    it("Create legacy loan type (no installments) and repay interest. 25 ETH principal, 2.5% interest rate.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, vaultFactory, mockERC20, loanCore, borrower, lender } = context;
        const { loanId, loanTerms, loanData, bundleId } = await initializeLoan(
            context,
            mockERC20.address,
            86400, // durationSecs
            hre.ethers.utils.parseEther("25"), // principal
            hre.ethers.utils.parseEther("250"), // interest
            0, // numInstallments
        );
        // total repayment amount
        const total = ethers.utils.parseEther("25.625");
        const repayAdditionalAmount = total.sub(await mockERC20.balanceOf(borrower.address));
        // mint borrower exactly enough to repay loan
        await mint(mockERC20, borrower, repayAdditionalAmount);
        await mockERC20.connect(borrower).approve(repaymentController.address, total);

        expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);

        await repaymentController.connect(borrower).repay(loanData.borrowerNoteId);

        expect(await mockERC20.balanceOf(borrower.address)).to.equal(0);
    });

    it("Create legacy loan type (no installments) and repay interest. 25 ETH principal, 2.5% interest rate. Borrower tries to repay with insufficient amount. Should revert.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, vaultFactory, mockERC20, loanCore, borrower, lender } = context;
        const { loanId, loanTerms, loanData, bundleId } = await initializeLoan(
            context,
            mockERC20.address,
            86400, // durationSecs
            hre.ethers.utils.parseEther("25"), // principal
            hre.ethers.utils.parseEther("250"), // interest
            0, // numInstallments
        );
        // total repayment amount less than 25.625ETH
        const total = ethers.utils.parseEther("25.624");
        const repayAdditionalAmount = total.sub(await mockERC20.balanceOf(borrower.address));
        // mint borrower exactly enough to repay loan
        await mint(mockERC20, borrower, repayAdditionalAmount);
        await mockERC20.connect(borrower).approve(repaymentController.address, total);

        expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);

        await expect(repaymentController.connect(borrower).repay(loanData.borrowerNoteId)).to.be.revertedWith(
            "ERC20: transfer amount exceeds balance",
        );
    });

    it("Create legacy loan type (no installments) and repay interest. 25 ETH principal, 2.5% interest rate. Repay function called without borrower approval. Should revert.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, vaultFactory, mockERC20, loanCore, borrower, lender } = context;
        const { loanId, loanTerms, loanData, bundleId } = await initializeLoan(
            context,
            mockERC20.address,
            86400, // durationSecs
            hre.ethers.utils.parseEther("25"), // principal
            hre.ethers.utils.parseEther("250"), // interest
            0, // numInstallments
        );
        // total repayment amount less than 25.625ETH
        const total = ethers.utils.parseEther("25.625");
        const repayAdditionalAmount = total.sub(await mockERC20.balanceOf(borrower.address));
        // mint borrower exactly enough to repay loan
        await mint(mockERC20, borrower, repayAdditionalAmount);

        expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);

        await expect(repaymentController.connect(borrower).repay(loanData.borrowerNoteId)).to.be.revertedWith(
            "ERC20: transfer amount exceeds allowance",
        );
    });

    it("Create legacy loan type (no installments) and repay interest. 25 ETH principal, 2.5% interest rate. Repay function called without borrower approval. Should revert.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, vaultFactory, mockERC20, loanCore, borrower, lender } = context;
        await expect(
            initializeLoan(
                context,
                mockERC20.address,
                86400, // durationSecs
                hre.ethers.utils.parseEther(".000000000000009999"), // principal
                hre.ethers.utils.parseEther("250"), // interest
                0, // numInstallments
            ),
        ).to.be.revertedWith("LoanCore::create: The minimum Principal allowed is 10000 wei.");
    });

    it("Create legacy loan type (no installments) and repay interest. 25 ETH principal, 2.5% interest rate. Repay function called without borrower approval. Should revert.", async () => {
        const context = await loadFixture(fixture);
        const { repaymentController, vaultFactory, mockERC20, loanCore, borrower, lender } = context;
        const { loanId, loanTerms, loanData, bundleId } = await initializeLoan(
            context,
            mockERC20.address,
            86400, // durationSecs
            hre.ethers.utils.parseEther(".00000000000001"), // principal
            hre.ethers.utils.parseEther("250"), // interest
            0, // numInstallments
        );
        // total repayment amount less than 25.625ETH
        const total = ethers.utils.parseEther(".000000000000010250");
        const repayAdditionalAmount = total.sub(await mockERC20.balanceOf(borrower.address));
        // mint borrower exactly enough to repay loan
        await mint(mockERC20, borrower, repayAdditionalAmount);
        await mockERC20.connect(borrower).approve(repaymentController.address, total);

        expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);

        await repaymentController.connect(borrower).repay(loanData.borrowerNoteId);

        expect(await mockERC20.balanceOf(borrower.address)).to.equal(0);
    });
});
