import chai, { expect } from "chai";
import hre, { waffle } from "hardhat";
import { solidity } from "ethereum-waffle";
const { loadFixture } = waffle;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber } from "ethers";
import { deploy } from "./utils/contracts";

chai.use(solidity);

import {
    OriginationController,
    CallWhitelist,
    MockERC20,
    VaultFactory,
    AssetVault,
    PromissoryNote,
    MockLoanCore,
} from "../typechain";
import { approve, mint, ZERO_ADDRESS } from "./utils/erc20";
import { LoanTerms } from "./utils/types";
import { createLoanTermsSignature, createPermitSignature } from "./utils/eip712";

// TODO:
// Fix existing tests
// Add tests for rest of OC
// Do verifier tests

type Signer = SignerWithAddress;

interface TestContext {
    originationController: OriginationController;
    mockERC20: MockERC20;
    vaultFactory: VaultFactory;
    lenderPromissoryNote: PromissoryNote;
    borrowerPromissoryNote: PromissoryNote;
    loanCore: MockLoanCore;
    user: Signer;
    other: Signer;
    signers: Signer[];
}

const initializeBundle = async (vaultFactory: VaultFactory, user: Signer): Promise<BigNumber> => {
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

const fixture = async (): Promise<TestContext> => {
    const signers: Signer[] = await hre.ethers.getSigners();
    const [deployer] = signers;

    const loanCore = <MockLoanCore>await deploy("MockLoanCore", deployer, []);
    const whitelist = <CallWhitelist>await deploy("CallWhitelist", deployer, []);
    const vaultTemplate = <AssetVault>await deploy("AssetVault", deployer, []);
    const vaultFactory = <VaultFactory>(
        await deploy("VaultFactory", deployer, [vaultTemplate.address, whitelist.address])
    );
    const mockERC20 = <MockERC20>await deploy("MockERC20", deployer, ["Mock ERC20", "MOCK"]);

    const originationController = <OriginationController>(
        await deploy("OriginationController", deployer, [loanCore.address])
    );

    const borrowerNoteAddress = await loanCore.borrowerNote();
    const lenderNoteAddress = await loanCore.lenderNote();

    const noteFactory = await hre.ethers.getContractFactory("PromissoryNote");
    const borrowerPromissoryNote = <PromissoryNote>await noteFactory.attach(borrowerNoteAddress);
    const lenderPromissoryNote = <PromissoryNote>await noteFactory.attach(lenderNoteAddress);

    return {
        originationController,
        mockERC20,
        vaultFactory,
        lenderPromissoryNote,
        borrowerPromissoryNote,
        loanCore,
        user: deployer,
        other: signers[1],
        signers: signers.slice(2),
    };
};

const createLoanTerms = (
    payableCurrency: string,
    collateralAddress: string,
    {
        durationSecs = 360000,
        principal = hre.ethers.utils.parseEther("100"),
        interest = hre.ethers.utils.parseEther("1"),
        collateralId = BigNumber.from("1"),
    }: Partial<LoanTerms> = {},
): LoanTerms => {
    return {
        durationSecs,
        principal,
        interest,
        collateralId,
        collateralAddress,
        payableCurrency
    };
};

const maxDeadline = hre.ethers.constants.MaxUint256;

describe("OriginationController", () => {
    describe("constructor", () => {
        it("Reverts if _loanCore address is not provided", async () => {
            const signers: Signer[] = await hre.ethers.getSigners();
            const [deployer] = signers;

            await expect(
                deploy("OriginationController", deployer, [ZERO_ADDRESS]),
            ).to.be.revertedWith("Origination: loanCore not defined");
        });

        it("Instantiates the OriginationController", async () => {
            const signers: Signer[] = await hre.ethers.getSigners();
            const [deployer] = signers;

            const loanCore = <MockLoanCore>await deploy("MockLoanCore", deployer, []);

            const originationController = await deploy("OriginationController", deployer, [
                loanCore.address
            ]);

            expect(await originationController.loanCore()).to.equal(loanCore.address);
        });
    });

    describe("initializeLoan", () => {
        it("Reverts if msg.sender is not either lender or borrower", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                user: lender,
                other: borrower,
                signers,
            } = await loadFixture(fixture);

            const bundleId = await initializeBundle(vaultFactory, borrower);

            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                borrower,
                "2"
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);

            await expect(
                originationController
                    // some random guy
                    .connect(signers[3])
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("Origination: caller not participant");
        });

        it("Reverts if wNFT not approved", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                user: lender,
                other: borrower,
            } = await loadFixture(fixture);

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                borrower,
                "2"
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            // no approval of wNFT token
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");
        });

        it("Reverts if principal not approved", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                user: lender,
                other: borrower,
            } = await loadFixture(fixture);

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                borrower,
                "2"
            );

            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
            // no approval of principal token
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });

        it("Reverts if approving own loan", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                user: lender,
                other: borrower,
            } = await loadFixture(fixture);

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                borrower,
                "2"
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
            await expect(
                originationController
                    // sender is the borrower, signer is also the borrower
                    .connect(borrower)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("Origination: no counterparty signature");
        });

        it("Reverts if signer is not a participant", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                user: lender,
                other: borrower,
                signers,
            } = await loadFixture(fixture);

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            await mint(mockERC20, lender, loanTerms.principal);

            // signer is some random guy
            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                signers[3],
                "2"
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("Origination: no counterparty signature");
        });

        it("Initializes a loan signed by the borrower", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                user: lender,
                other: borrower,
            } = await loadFixture(fixture);

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                borrower,
                "2"
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            )
                .to.emit(mockERC20, "Transfer")
                .withArgs(await lender.getAddress(), originationController.address, loanTerms.principal);
        });

        it("Initializes a loan signed by the lender", async () => {
            const {
                originationController,
                mockERC20,
                vaultFactory,
                user: lender,
                other: borrower,
            } = await loadFixture(fixture);

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                lender,
                "2"
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
            await expect(
                originationController
                    .connect(borrower)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            )
                .to.emit(mockERC20, "Transfer")
                .withArgs(await lender.getAddress(), originationController.address, loanTerms.principal);
        });

        describe("initializeLoanWithCollateralPermit", () => {
            it("Reverts if vaultFactory.permit is invalid", async () => {
                const {
                    originationController,
                    vaultFactory,
                    user,
                    other,
                    mockERC20,
                    lenderPromissoryNote,
                    borrowerPromissoryNote,
                } = await loadFixture(fixture);

                const bundleId = await initializeBundle(vaultFactory, user);
                const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
                await mint(mockERC20, other, loanTerms.principal);

                // invalid signature because tokenId is something random here
                const permitData = {
                    owner: await user.getAddress(),
                    spender: originationController.address,
                    tokenId: 1234,
                    nonce: 0,
                    deadline: maxDeadline,
                };

                const collateralSig = await createPermitSignature(vaultFactory.address, await vaultFactory.name(), permitData, user);

                const sig = await createLoanTermsSignature(
                    originationController.address,
                    "OriginationController",
                    loanTerms,
                    user,
                );

                await expect(
                    originationController
                        .connect(user)
                        .initializeLoanWithCollateralPermit(
                            loanTerms,
                            lenderPromissoryNote.address,
                            borrowerPromissoryNote.address,
                            sig,
                            collateralSig,
                            maxDeadline,
                        ),
                ).to.be.revertedWith("ERC721Permit: not owner");
            });

            it("Initializes a loan with permit", async () => {
                const {
                    originationController,
                    mockERC20,
                    vaultFactory,
                    user: lender,
                    other: borrower,
                } = await loadFixture(fixture);

                const bundleId = await initializeBundle(vaultFactory, borrower);
                const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
                await mint(mockERC20, lender, loanTerms.principal);

                const permitData = {
                    owner: await borrower.getAddress(),
                    spender: originationController.address,
                    tokenId: bundleId,
                    nonce: 0,
                    deadline: maxDeadline,
                };
                const collateralSig = await createPermitSignature(vaultFactory.address, await vaultFactory.name(), permitData, borrower);

                const sig = await createLoanTermsSignature(
                    originationController.address,
                    "OriginationController",
                    loanTerms,
                    borrower,
                    "2"
                );

                await approve(mockERC20, lender, originationController.address, loanTerms.principal);
                await expect(
                    originationController
                        .connect(lender)
                        .initializeLoanWithCollateralPermit(
                            loanTerms,
                            await borrower.getAddress(),
                            await lender.getAddress(),
                            sig,
                            collateralSig,
                            maxDeadline
                        ),
                )
                    .to.emit(mockERC20, "Transfer")
                    .withArgs(await lender.getAddress(), originationController.address, loanTerms.principal);
            });
        });
    });
});
