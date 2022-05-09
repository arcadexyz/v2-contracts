import { expect } from "chai";
import hre, { ethers, waffle } from "hardhat";
const { loadFixture } = waffle;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber } from "ethers";

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
}

describe("Integration", () => {
    const blockchainTime = new BlockchainTime();

    /**
     * Sets up a test context, deploying new contracts and returning them for use in a test
     */
    const fixture = async (): Promise<TestContext> => {
        const signers: SignerWithAddress[] = await hre.ethers.getSigners();
        const [borrower, lender, admin] = signers;

        const whitelist = <CallWhitelist>await deploy("CallWhitelist", signers[0], []);
        const vaultTemplate = <AssetVault>await deploy("AssetVault", signers[0], []);
        const vaultFactory = <VaultFactory>(
            await deploy("VaultFactory", signers[0], [vaultTemplate.address, whitelist.address])
        );
        const feeController = <FeeController>await deploy("FeeController", admin, []);
        const loanCore = <LoanCore>await deploy("LoanCore", admin, [feeController.address]);

        const borrowerNoteAddress = await loanCore.borrowerNote();
        const borrowerNote = <PromissoryNote>(
            (await ethers.getContractFactory("PromissoryNote")).attach(borrowerNoteAddress)
        );

        const lenderNoteAddress = await loanCore.lenderNote();
        const lenderNote = <PromissoryNote>(
            (await ethers.getContractFactory("PromissoryNote")).attach(lenderNoteAddress)
        );

        const mockERC20 = <MockERC20>await deploy("MockERC20", admin, ["Mock ERC20", "MOCK"]);

        const repaymentController = <RepaymentController>(
            await deploy("RepaymentController", admin, [loanCore.address, borrowerNoteAddress, lenderNoteAddress])
        );
        await repaymentController.deployed();
        const updateRepaymentControllerPermissions = await loanCore.grantRole(
            REPAYER_ROLE,
            repaymentController.address,
        );
        await updateRepaymentControllerPermissions.wait();

        const originationController = <OriginationController>(
            await deploy("OriginationController", admin, [loanCore.address])
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
        };
    };

    /**
     * Create a LoanTerms object using the given parameters, or defaults
     */
    const createLoanTerms = (
        payableCurrency: string,
        collateralAddress: string,
        {
            durationSecs = 3600000,
            principal = hre.ethers.utils.parseEther("100"),
            interest = hre.ethers.utils.parseEther("1"),
            collateralId = BigNumber.from(1),
        }: Partial<LoanTerms> = {},
    ): LoanTerms => {
        return {
            durationSecs,
            principal,
            interest,
            collateralAddress,
            collateralId,
            payableCurrency,
        };
    };

    const createWnft = async (vaultFactory: VaultFactory, user: SignerWithAddress) => {
        const tx = await vaultFactory.initializeBundle(await user.getAddress());
        const receipt = await tx.wait();
        if (receipt && receipt.events && receipt.events.length === 2 && receipt.events[1].args) {
            return receipt.events[1].args.vault;
        } else {
            throw new Error("Unable to initialize bundle");
        }
    };

    describe("Originate Loan", function () {
        it("should successfully create a loan", async () => {
            const { originationController, mockERC20, loanCore, vaultFactory, lender, borrower } = await loadFixture(
                fixture,
            );

            const bundleId = await createWnft(vaultFactory, borrower);
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

            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            )
                .to.emit(mockERC20, "Transfer")
                .withArgs(await lender.getAddress(), originationController.address, loanTerms.principal)
                .to.emit(mockERC20, "Transfer")
                .withArgs(originationController.address, loanCore.address, loanTerms.principal)
                .to.emit(loanCore, "LoanCreated")
                .to.emit(loanCore, "LoanStarted");
        });

        it("should fail to start loan if wNFT has withdraws enabled", async () => {
            const { originationController, mockERC20, vaultFactory, lender, borrower } = await loadFixture(fixture);

            const bundleId = await createWnft(vaultFactory, borrower);
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
            // simulate someone trying to withdraw just before initializing the loan
            await AssetVault__factory.connect(bundleId, borrower).connect(borrower).enableWithdraw();
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("cannot transfer with withdraw enabled");
        });

        it("should fail to create a loan with nonexistent collateral", async () => {
            const { originationController, mockERC20, lender, borrower, vaultFactory } = await loadFixture(fixture);

            const mockOpenVault = await deploy("MockOpenVault", borrower, []);
            const bundleId = BigNumber.from(mockOpenVault.address);
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
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("ERC721: operator query for nonexistent token");
        });

        it("should fail to create a loan with passed due date", async () => {
            const { originationController, mockERC20, vaultFactory, lender, borrower } = await loadFixture(fixture);
            const bundleId = await createWnft(vaultFactory, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, {
                collateralId: bundleId,
                durationSecs: 0,
            });
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
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("LoanCore::create: Loan is already expired");
        });
    });

    describe("Repay Loan", function () {
        interface LoanDef {
            loanId: string;
            bundleId: string;
            loanTerms: LoanTerms;
            loanData: LoanData;
        }

        const initializeLoan = async (context: TestContext, terms?: Partial<LoanTerms>): Promise<LoanDef> => {
            const { originationController, mockERC20, vaultFactory, loanCore, lender, borrower } = context;
            const bundleId = terms?.collateralId ?? (await createWnft(vaultFactory, borrower));
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            if (terms) Object.assign(loanTerms, terms);

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

        it("should successfully repay loan", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, vaultFactory, mockERC20, loanCore, borrower, lender } = context;
            const { loanId, loanTerms, loanData, bundleId } = await initializeLoan(context);

            await mint(mockERC20, borrower, loanTerms.principal.add(loanTerms.interest));
            await mockERC20
                .connect(borrower)
                .approve(repaymentController.address, loanTerms.principal.add(loanTerms.interest));

            // pre-repaid state
            expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);
            const preLenderBalance = await mockERC20.balanceOf(await lender.getAddress());

            await expect(repaymentController.connect(borrower).repay(loanData.borrowerNoteId))
                .to.emit(loanCore, "LoanRepaid")
                .withArgs(loanId);

            // post-repaid state
            expect(await vaultFactory.ownerOf(bundleId)).to.equal(await borrower.getAddress());
            const postLenderBalance = await mockERC20.balanceOf(await lender.getAddress());
            expect(postLenderBalance.sub(preLenderBalance)).to.equal(ethers.utils.parseEther("100.01"));
        });

        it("should allow the collateral to be reused after repay", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, loanCore, borrower } = context;
            const { loanId, loanTerms, loanData, bundleId } = await initializeLoan(context);

            await mint(mockERC20, borrower, loanTerms.principal.add(loanTerms.interest));
            await mockERC20
                .connect(borrower)
                .approve(repaymentController.address, loanTerms.principal.add(loanTerms.interest));

            await expect(repaymentController.connect(borrower).repay(loanData.borrowerNoteId))
                .to.emit(loanCore, "LoanRepaid")
                .withArgs(loanId);

            // create a new loan with the same bundleId
            const { loanId: newLoanId } = await initializeLoan(context, {
                collateralId: hre.ethers.BigNumber.from(bundleId),
            });

            // initializeLoan asserts loan created successfully based on logs, so test that new loan is a new instance
            expect(newLoanId !== loanId);
        });

        it("fails if payable currency is not approved", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower } = context;
            const { loanTerms, loanData } = await initializeLoan(context);

            await mint(mockERC20, borrower, loanTerms.principal.add(loanTerms.interest));

            await expect(repaymentController.connect(borrower).repay(loanData.borrowerNoteId)).to.be.revertedWith(
                "ERC20: transfer amount exceeds allowance",
            );
        });

        it("fails with invalid note ID", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, mockERC20, borrower } = context;
            const { loanTerms } = await initializeLoan(context);

            await mint(mockERC20, borrower, loanTerms.principal.add(loanTerms.interest));
            await mockERC20
                .connect(borrower)
                .approve(repaymentController.address, loanTerms.principal.add(loanTerms.interest));

            await expect(repaymentController.connect(borrower).repay(1234)).to.be.revertedWith(
                "RepaymentController: repay could not dereference loan",
            );
        });
    });

    describe("Claim loan", function () {
        interface LoanDef {
            loanId: string;
            bundleId: string;
            loanTerms: LoanTerms;
            loanData: LoanData;
        }

        const initializeLoan = async (context: TestContext, terms?: Partial<LoanTerms>): Promise<LoanDef> => {
            const { originationController, mockERC20, vaultFactory, loanCore, lender, borrower } = context;
            const durationSecs = 1000;
            const bundleId = terms?.collateralId ?? (await createWnft(vaultFactory, borrower));
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, {
                collateralId: bundleId,
                durationSecs,
            });
            if (terms) Object.assign(loanTerms, terms);
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
            if (receipt && receipt.events) {
                const LoanCreatedLog = new hre.ethers.utils.Interface([
                    "event LoanStarted(uint256 loanId, address lender, address borrower)",
                ]);
                const log = LoanCreatedLog.parseLog(receipt.events[receipt.events.length - 1]);
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

        it("should successfully claim loan", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, vaultFactory, loanCore, lender } = context;
            const { loanId, loanData, bundleId } = await initializeLoan(context);

            // pre-repaid state
            expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);
            await blockchainTime.increaseTime(5000);

            await expect(repaymentController.connect(lender).claim(loanData.lenderNoteId))
                .to.emit(loanCore, "LoanClaimed")
                .withArgs(loanId);

            // post-repaid state
            expect(await vaultFactory.ownerOf(bundleId)).to.equal(await lender.getAddress());
        });

        it("should allow the collateral to be reused after claim", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, vaultFactory, loanCore, lender, borrower } = context;
            const { loanId, loanData, bundleId } = await initializeLoan(context);

            // pre-repaid state
            expect(await vaultFactory.ownerOf(bundleId)).to.equal(loanCore.address);
            await blockchainTime.increaseTime(5000);

            await expect(repaymentController.connect(lender).claim(loanData.lenderNoteId))
                .to.emit(loanCore, "LoanClaimed")
                .withArgs(loanId);

            // create a new loan with the same bundleId
            // transfer the collateral back to the original borrower
            await vaultFactory
                .connect(lender)
                .transferFrom(await lender.getAddress(), await borrower.getAddress(), bundleId);
            const { loanId: newLoanId } = await initializeLoan(context, {
                collateralId: hre.ethers.BigNumber.from(bundleId),
            });

            // initializeLoan asserts loan created successfully based on logs, so test that new loan is a new instance
            expect(newLoanId !== loanId);
        });

        it("fails if not past durationSecs", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, lender } = context;
            const { loanData } = await initializeLoan(context);

            await expect(repaymentController.connect(lender).claim(loanData.lenderNoteId)).to.be.revertedWith(
                "LoanCore::claim: Loan not expired",
            );
        });

        it("fails for invalid noteId", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, lender } = context;

            await blockchainTime.increaseTime(5000);
            await expect(repaymentController.connect(lender).claim(1234)).to.be.revertedWith(
                "ERC721: owner query for nonexistent token",
            );
        });

        it("fails if not called by lender", async () => {
            const context = await loadFixture(fixture);
            const { repaymentController, borrower } = context;
            const { loanData } = await initializeLoan(context);

            await blockchainTime.increaseTime(5000);
            await expect(repaymentController.connect(borrower).claim(loanData.lenderNoteId)).to.be.revertedWith(
                "RepaymentController: not owner of lender note",
            );
        });
    });
});
