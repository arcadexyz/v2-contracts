import { expect } from "chai";
import hre, { waffle, upgrades } from "hardhat";
const { loadFixture } = waffle;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber, BigNumberish } from "ethers";
import { initializeBundle } from "./utils/loans";
import {
    OriginationController,
    MockERC20,
    LoanCore,
    MockERC721,
    PromissoryNote,
    CallWhitelist,
    VaultFactory,
    AssetVault,
    FeeController,
    RepaymentController,
} from "../typechain";
import { deploy } from "./utils/contracts";
import { LoanTerms, LoanState } from "./utils/types";
import { fromRpcSig } from "ethereumjs-util";

type Signer = SignerWithAddress;

const ORIGINATOR_ROLE = "0x59abfac6520ec36a6556b2a4dd949cc40007459bcd5cd2507f1e5cc77b6bc97e";
const REPAYER_ROLE = "0x9c60024347074fd9de2c1e36003080d22dbc76a41ef87444d21e361bcb39118e";

interface TestContext {
    borrowerPromissoryNote: PromissoryNote;
    lenderPromissoryNote: PromissoryNote;
    loanCore: LoanCore;
    repaymentController: RepaymentController;
    originationController: OriginationController;
    vaultFactory: VaultFactory;
    mockERC20: MockERC20;
    repayer: Signer;
    originator: Signer;
    user: Signer;
    other: Signer;
    signers: Signer[];
}

describe("PromissoryNote", () => {
    // ========== HELPER FUNCTIONS ===========
    // Create Loan Terms
    const createLoanTerms = (
        payableCurrency: string,
        collateralAddress: string,
        {
            durationSecs = BigNumber.from(360000),
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
            collateralId,
            collateralAddress,
            payableCurrency,
            numInstallments,
        };
    };

    // Context / Fixture
    const fixture = async (): Promise<TestContext> => {
        const signers: Signer[] = await hre.ethers.getSigners();

        const whitelist = <CallWhitelist>await deploy("CallWhitelist", signers[0], []);
        const vaultTemplate = <AssetVault>await deploy("AssetVault", signers[0], []);
        const VaultFactoryFactory = await hre.ethers.getContractFactory("VaultFactory");
    const vaultFactory = <VaultFactory>(await upgrades.deployProxy(VaultFactoryFactory, [vaultTemplate.address, whitelist.address], { kind: 'uups' })
    );
        const mockERC20 = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);

        const feeController = <FeeController>await deploy("FeeController", signers[0], []);

        const LoanCore = await hre.ethers.getContractFactory("LoanCore");
        const loanCore = <LoanCore>(
            await upgrades.deployProxy(LoanCore, [feeController.address], { kind: 'uups' })
        );

        const OriginationController = await hre.ethers.getContractFactory("OriginationController");
        const originationController = <OriginationController>(
            await upgrades.deployProxy(OriginationController, [loanCore.address], { kind: 'uups' })
        );
        await originationController.deployed();
        const originator = signers[0];
        const repayer = signers[0];

        await loanCore.connect(signers[0]).grantRole(ORIGINATOR_ROLE, await originator.getAddress());
        await loanCore.connect(signers[0]).grantRole(REPAYER_ROLE, await repayer.getAddress());

        const lenderPromissoryNote = <PromissoryNote>(
            await deploy("PromissoryNote", signers[0], ["PromissoryNote - Lender", "PBL"])
        );
        const borrowerPromissoryNote = <PromissoryNote>(
            await deploy("PromissoryNote", signers[0], ["PromissoryNote - Borrower", "PBNs"])
        );

        const repaymentController = <RepaymentController>(
            await deploy("RepaymentController", signers[0], [
                loanCore.address,
                borrowerPromissoryNote.address,
                lenderPromissoryNote.address,
            ])
        );
        await repaymentController.deployed();
        const updateRepaymentControllerPermissions = await loanCore.grantRole(
            REPAYER_ROLE,
            repaymentController.address,
        );
        await updateRepaymentControllerPermissions.wait();

        return {
            borrowerPromissoryNote,
            lenderPromissoryNote,
            loanCore,
            repaymentController,
            originationController,
            vaultFactory,
            mockERC20,
            repayer,
            originator,
            user: signers[0],
            other: signers[1],
            signers: signers.slice(2),
        };
    };

    // Create Loan
    const createLoan = async (loanCore: LoanCore, user: Signer, terms: LoanTerms): Promise<BigNumber> => {
        const transaction = await loanCore.connect(user).createLoan(terms);
        const receipt = await transaction.wait();

        if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
            return receipt.events[0].args.loanId;
        } else {
            throw new Error("Unable to initialize loan");
        }
    };

    // Start Loan
    const startLoan = async (
        loanCore: LoanCore,
        user: Signer,
        lenderNote: PromissoryNote,
        borrowerNote: PromissoryNote,
        loanId: BigNumber,
    ) => {
        const transaction = await loanCore.connect(user).startLoan(lenderNote.address, borrowerNote.address, loanId);
        await transaction.wait();
    };

    // Repay Loan
    const repayLoan = async (
        loanCore: LoanCore,
        repaymentController: RepaymentController,
        user: Signer,
        loanId: BigNumber,
    ) => {
        const loanData = await loanCore.connect(user).getLoan(loanId);
        const transaction = await repaymentController.connect(user).repay(loanData.borrowerNoteId);
        await transaction.wait();
    };

    // Mint Promissory Note
    const mintPromissoryNote = async (note: PromissoryNote, user: Signer): Promise<BigNumber> => {
        const transaction = await note.mint(await user.getAddress(), 1);
        const receipt = await transaction.wait();

        if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
            return receipt.events[0].args.tokenId;
        } else {
            throw new Error("Unable to mint promissory note");
        }
    };

    // ========== PROMISSORY NOTE TESTS ===========
    describe("constructor", () => {
        it("Creates a PromissoryNote", async () => {
            const signers: Signer[] = await hre.ethers.getSigners();

            const PromissoryNote = <PromissoryNote>await deploy("PromissoryNote", signers[0], ["PromissoryNote", "BN"]);

            expect(PromissoryNote).exist;
        });
    });

    describe("mint", () => {
        it("Reverts if sender is not loanCore", async () => {
            const { lenderPromissoryNote: promissoryNote, user, other } = await loadFixture(fixture);
            const transaction = promissoryNote.connect(other).mint(await user.getAddress(), 1);
            await expect(transaction).to.be.reverted;
        });

        it("Assigns a PromissoryNote NFT to the recipient", async () => {
            const { lenderPromissoryNote: promissoryNote, user, other } = await loadFixture(fixture);
            const transaction = await promissoryNote.connect(user).mint(await other.getAddress(), 1);
            const receipt = await transaction.wait();

            if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
                return expect(receipt.events[0]).exist;
            } else {
                throw new Error("Unable to mint promissory note");
            }
        });
    });

    describe("burn", () => {
        it("Reverts if sender does not own the note", async () => {
            const {
                borrowerPromissoryNote: promissoryNote,
                lenderPromissoryNote,
                loanCore,
                repaymentController,
                originationController,
                vaultFactory,
                user,
                other,
                repayer,
                originator,
                mockERC20,
            } = await loadFixture(fixture);
            // init bundle using vault factory
            const bundleId = await initializeBundle(vaultFactory, user);
            // create loan terms
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            const promissoryNoteId = await mintPromissoryNote(promissoryNote, user);
            const loanId = await createLoan(loanCore, user, loanTerms);
            // Approve loanCore to take vault when loan starts
            await vaultFactory.connect(user).approve(loanCore.address, bundleId);
            // Mint principal to lender, lender then approves loanCore to take amount
            await mockERC20.connect(other).mint(await other.getAddress(), loanTerms.principal);
            await mockERC20.connect(other).transfer(await originator.getAddress(), loanTerms.principal);
            await mockERC20.connect(originator).approve(loanCore.address, loanTerms.principal);
            // LoanCore starts loan, with originator as the msg.sender. Mint user principal to emulate the tx
            await startLoan(loanCore, originator, lenderPromissoryNote, promissoryNote, loanId);
            // enough for principal and int
            await mockERC20.connect(user).mint(await user.getAddress(), loanTerms.principal.mul(2));
            const loanData = await loanCore.connect(user).getLoan(loanId);
            expect(loanData.state).to.equal(LoanState.Active);
            // Repay loan with repayment controller, approve first
            await mockERC20.connect(user).approve(repaymentController.address, hre.ethers.utils.parseEther("100.01"));
            await repayLoan(loanCore, repaymentController, user, loanId);
            const loanDataAfterRepay = await loanCore.connect(user).getLoan(loanId);
            expect(loanDataAfterRepay.state).to.equal(LoanState.Repaid);

            await expect(promissoryNote.connect(other).burn(promissoryNoteId)).to.be.reverted;
        });

        it("Burns a PromissoryNote NFT", async () => {
            const {
                borrowerPromissoryNote: promissoryNote,
                lenderPromissoryNote,
                loanCore,
                originationController,
                repaymentController,
                vaultFactory,
                repayer,
                originator,
                other,
                user,
                mockERC20,
            } = await loadFixture(fixture);
            // init bundle using vault factory
            const bundleId = await initializeBundle(vaultFactory, user);
            // create loan terms
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            const promissoryNoteId = await mintPromissoryNote(promissoryNote, user);
            const loanId = await createLoan(loanCore, user, loanTerms);
            // Approve loanCore to take vault when loan starts
            await vaultFactory.connect(user).approve(loanCore.address, bundleId);
            // Mint principal to lender, lender then approves loanCore to take amount
            await mockERC20.connect(other).mint(await other.getAddress(), loanTerms.principal);
            await mockERC20.connect(other).transfer(await originator.getAddress(), loanTerms.principal);
            await mockERC20.connect(originator).approve(loanCore.address, loanTerms.principal);
            // LoanCore starts loan, with originator as the msg.sender. Mint user principal to emulate the tx
            await startLoan(loanCore, originator, lenderPromissoryNote, promissoryNote, loanId);
            // enough for principal and int
            await mockERC20.connect(user).mint(await user.getAddress(), loanTerms.principal.mul(2));
            const loanData = await loanCore.connect(user).getLoan(loanId);
            expect(loanData.state).to.equal(LoanState.Active);
            // Repay loan with repayment controller, approve first
            await mockERC20.connect(user).approve(repaymentController.address, hre.ethers.utils.parseEther("100.01"));
            await repayLoan(loanCore, repaymentController, user, loanId);
            const loanDataAfterRepay = await loanCore.connect(user).getLoan(loanId);
            expect(loanDataAfterRepay.state).to.equal(LoanState.Repaid);
            await expect(promissoryNote.connect(user).burn(promissoryNoteId)).to.not.be.reverted;
        });
    });

    describe("Permit", () => {
        const typedData = {
            types: {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "tokenId", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                ],
            },
            primaryType: "Permit" as const,
        };

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const chainId = hre.network.config.chainId!;
        const maxDeadline = hre.ethers.constants.MaxUint256;

        const buildData = (
            chainId: number,
            verifyingContract: string,
            name: string,
            version: string,
            owner: string,
            spender: string,
            tokenId: BigNumberish,
            nonce: number,
            deadline = maxDeadline,
        ) => {
            return Object.assign({}, typedData, {
                domain: {
                    name,
                    version,
                    chainId,
                    verifyingContract,
                },
                message: { owner, spender, tokenId, nonce, deadline },
            });
        };

        let promissoryNote: PromissoryNote;
        let user: Signer;
        let other: Signer;
        let promissoryNoteId: BigNumber;
        let signature: string;
        let v: number;
        let r: Buffer;
        let s: Buffer;

        beforeEach(async () => {
            ({ borrowerPromissoryNote: promissoryNote, user, other } = await loadFixture(fixture));
            promissoryNoteId = await mintPromissoryNote(promissoryNote, user);

            const data = buildData(
                chainId,
                promissoryNote.address,
                await promissoryNote.name(),
                "1",
                await user.getAddress(),
                await other.getAddress(),
                promissoryNoteId,
                0,
            );

            signature = await user._signTypedData(data.domain, data.types, data.message);
            ({ v, r, s } = fromRpcSig(signature));
        });

        it("should accept owner signature", async () => {
            let approved = await promissoryNote.getApproved(promissoryNoteId);
            expect(approved).to.equal(hre.ethers.constants.AddressZero);

            await expect(
                promissoryNote.permit(
                    await user.getAddress(),
                    await other.getAddress(),
                    promissoryNoteId,
                    maxDeadline,
                    v,
                    r,
                    s,
                ),
            )
                .to.emit(promissoryNote, "Approval")
                .withArgs(await user.getAddress(), await other.getAddress(), promissoryNoteId);

            approved = await promissoryNote.getApproved(promissoryNoteId);
            expect(approved).to.equal(await other.getAddress());
        });

        it("rejects if given owner is not real owner", async () => {
            const approved = await promissoryNote.getApproved(promissoryNoteId);
            expect(approved).to.equal(hre.ethers.constants.AddressZero);

            await expect(
                promissoryNote.permit(
                    await other.getAddress(),
                    await other.getAddress(),
                    promissoryNoteId,
                    maxDeadline,
                    v,
                    r,
                    s,
                ),
            ).to.be.revertedWith("ERC721Permit: not owner");
        });

        it("rejects if promissoryNoteId is not valid", async () => {
            const approved = await promissoryNote.getApproved(promissoryNoteId);
            expect(approved).to.equal(hre.ethers.constants.AddressZero);
            const otherNoteId = await mintPromissoryNote(promissoryNote, user);

            await expect(
                promissoryNote.permit(
                    await other.getAddress(),
                    await other.getAddress(),
                    otherNoteId,
                    maxDeadline,
                    v,
                    r,
                    s,
                ),
            ).to.be.revertedWith("ERC721Permit: not owner");
        });

        it("rejects reused signature", async () => {
            await expect(
                promissoryNote.permit(
                    await user.getAddress(),
                    await other.getAddress(),
                    promissoryNoteId,
                    maxDeadline,
                    v,
                    r,
                    s,
                ),
            )
                .to.emit(promissoryNote, "Approval")
                .withArgs(await user.getAddress(), await other.getAddress(), promissoryNoteId);

            await expect(
                promissoryNote.permit(
                    await user.getAddress(),
                    await other.getAddress(),
                    promissoryNoteId,
                    maxDeadline,
                    v,
                    r,
                    s,
                ),
            ).to.be.revertedWith("ERC721Permit: invalid signature");
        });

        it("rejects other signature", async () => {
            const data = buildData(
                chainId,
                promissoryNote.address,
                await promissoryNote.name(),
                "1",
                await user.getAddress(),
                await other.getAddress(),
                promissoryNoteId,
                0,
            );

            const signature = await other._signTypedData(data.domain, data.types, data.message);
            const { v, r, s } = fromRpcSig(signature);

            await expect(
                promissoryNote.permit(
                    await user.getAddress(),
                    await other.getAddress(),
                    promissoryNoteId,
                    maxDeadline,
                    v,
                    r,
                    s,
                ),
            ).to.be.revertedWith("ERC721Permit: invalid signature");
        });

        it("rejects expired signature", async () => {
            const data = buildData(
                chainId,
                promissoryNote.address,
                await promissoryNote.name(),
                "1",
                await user.getAddress(),
                await other.getAddress(),
                promissoryNoteId,
                0,
                BigNumber.from("1234"),
            );

            const signature = await user._signTypedData(data.domain, data.types, data.message);
            const { v, r, s } = fromRpcSig(signature);

            const approved = await promissoryNote.getApproved(promissoryNoteId);
            expect(approved).to.equal(hre.ethers.constants.AddressZero);

            await expect(
                promissoryNote.permit(
                    await user.getAddress(),
                    await other.getAddress(),
                    promissoryNoteId,
                    BigNumber.from("1234"),
                    v,
                    r,
                    s,
                ),
            ).to.be.revertedWith("ERC721Permit: expired deadline");
        });
    });
});
