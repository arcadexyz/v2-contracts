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
    MockERC721,
    VaultFactory,
    AssetVault,
    PromissoryNote,
    MockLoanCore,
    ArcadeItemsVerifier,
    FeeController,
} from "../typechain";
import { approve, mint, ZERO_ADDRESS } from "./utils/erc20";
import { mint as mint721 } from "./utils/erc721";
import { ItemsPredicate, LoanTerms, SignatureItem } from "./utils/types";
import { createLoanTermsSignature, createLoanItemsSignature, createPermitSignature } from "./utils/eip712";
import { encodePredicates, encodeSignatureItems, initializeBundle } from "./utils/loans";

type Signer = SignerWithAddress;

interface TestContext {
    originationController: OriginationController;
    mockERC20: MockERC20;
    mockERC721: MockERC721;
    vaultFactory: VaultFactory;
    lenderPromissoryNote: PromissoryNote;
    borrowerPromissoryNote: PromissoryNote;
    loanCore: MockLoanCore;
    user: Signer;
    other: Signer;
    signers: Signer[];
}

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
    const mockERC721 = <MockERC721>await deploy("MockERC721", deployer, ["Mock ERC721", "MOCK"]);

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
        mockERC721,
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
        numInstallments = 0,
    }: Partial<LoanTerms> = {},
): LoanTerms => {
    return {
        durationSecs,
        principal,
        interest,
        collateralId,
        collateralAddress,
        payableCurrency,
        numInstallments,
    };
};

const maxDeadline = hre.ethers.constants.MaxUint256;

describe("OriginationController", () => {
    describe("constructor", () => {
        it("Reverts if _loanCore address is not provided", async () => {
            const signers: Signer[] = await hre.ethers.getSigners();
            const [deployer] = signers;

            await expect(deploy("OriginationController", deployer, [ZERO_ADDRESS])).to.be.revertedWith(
                "Origination: loanCore not defined",
            );
        });

        it("Instantiates the OriginationController", async () => {
            const signers: Signer[] = await hre.ethers.getSigners();
            const [deployer] = signers;

            const loanCore = <MockLoanCore>await deploy("MockLoanCore", deployer, []);

            const originationController = await deploy("OriginationController", deployer, [loanCore.address]);

            expect(await originationController.loanCore()).to.equal(loanCore.address);
        });
    });

    describe("initializeLoan", () => {
        let ctx: TestContext;

        beforeEach(async () => {
            ctx = await loadFixture(fixture);
        });

        it("Reverts if msg.sender is not either lender or borrower", async () => {
            const { originationController, mockERC20, vaultFactory, user: lender, other: borrower, signers } = ctx;

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

            await expect(
                originationController
                    // some random guy
                    .connect(signers[3])
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("Origination: caller not participant");
        });

        it("Reverts if wNFT not approved", async () => {
            const { originationController, mockERC20, vaultFactory, user: lender, other: borrower } = ctx;

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
            // no approval of wNFT token
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");
        });

        it("Reverts if principal not approved", async () => {
            const { originationController, mockERC20, vaultFactory, user: lender, other: borrower } = ctx;

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

            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
            // no approval of principal token
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
        });

        it("Reverts if approving own loan", async () => {
            const { originationController, mockERC20, vaultFactory, user: lender, other: borrower } = ctx;

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
            await expect(
                originationController
                    // sender is the borrower, signer is also the borrower
                    .connect(borrower)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            ).to.be.revertedWith("Origination: approved own loan");
        });

        it("Reverts if signer is not a participant", async () => {
            const { originationController, mockERC20, vaultFactory, user: lender, other: borrower, signers } = ctx;

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            await mint(mockERC20, lender, loanTerms.principal);

            // signer is some random guy
            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                signers[3],
                "2",
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
            const { originationController, mockERC20, vaultFactory, user: lender, other: borrower } = ctx;

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
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            )
                .to.emit(mockERC20, "Transfer")
                .withArgs(await lender.getAddress(), originationController.address, loanTerms.principal);
        });

        it("Initializes a loan signed by the lender", async () => {
            const { originationController, mockERC20, vaultFactory, user: lender, other: borrower } = ctx;

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                lender,
                "2",
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

        it("Initializes a loan with unbundled collateral", async () => {
            const { originationController, mockERC20, mockERC721, user: lender, other: borrower } = ctx;

            const tokenId = await mint721(mockERC721, borrower);
            const loanTerms = createLoanTerms(mockERC20.address, mockERC721.address, { collateralId: tokenId });

            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanTermsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                borrower,
                "2",
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            await mockERC721.connect(borrower).approve(originationController.address, tokenId);
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoan(loanTerms, await borrower.getAddress(), await lender.getAddress(), sig),
            )
                .to.emit(mockERC20, "Transfer")
                .withArgs(await lender.getAddress(), originationController.address, loanTerms.principal);
        });

        describe("initializeLoanWithCollateralPermit", () => {
            it("Reverts if the collateral does not support permit", async () => {
                const {
                    originationController,
                    vaultFactory,
                    user,
                    other,
                    mockERC20,
                    mockERC721,
                    lenderPromissoryNote,
                    borrowerPromissoryNote,
                } = ctx;

                const tokenId = await mint721(mockERC721, other);
                const loanTerms = createLoanTerms(mockERC20.address, mockERC721.address, { collateralId: tokenId });

                await mint(mockERC20, other, loanTerms.principal);

                // invalid signature because tokenId is something random here
                const permitData = {
                    owner: await user.getAddress(),
                    spender: originationController.address,
                    tokenId: 1234,
                    nonce: 0,
                    deadline: maxDeadline,
                };

                const collateralSig = await createPermitSignature(
                    vaultFactory.address,
                    await vaultFactory.name(),
                    permitData,
                    user,
                );

                const sig = await createLoanTermsSignature(
                    originationController.address,
                    "OriginationController",
                    loanTerms,
                    user,
                    "2",
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
                ).to.be.revertedWith("function selector was not recognized and there's no fallback function");
            });

            it("Reverts if vaultFactory.permit is invalid", async () => {
                const {
                    originationController,
                    vaultFactory,
                    user,
                    other,
                    mockERC20,
                    lenderPromissoryNote,
                    borrowerPromissoryNote,
                } = ctx;

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

                const collateralSig = await createPermitSignature(
                    vaultFactory.address,
                    await vaultFactory.name(),
                    permitData,
                    user,
                );

                const sig = await createLoanTermsSignature(
                    originationController.address,
                    "OriginationController",
                    loanTerms,
                    user,
                    "2",
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
                const { originationController, mockERC20, vaultFactory, user: lender, other: borrower } = ctx;

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
                const collateralSig = await createPermitSignature(
                    vaultFactory.address,
                    await vaultFactory.name(),
                    permitData,
                    borrower,
                );

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
                        .initializeLoanWithCollateralPermit(
                            loanTerms,
                            await borrower.getAddress(),
                            await lender.getAddress(),
                            sig,
                            collateralSig,
                            maxDeadline,
                        ),
                )
                    .to.emit(mockERC20, "Transfer")
                    .withArgs(await lender.getAddress(), originationController.address, loanTerms.principal);
            });
        });
    });

    describe("initializeLoanWithItems", () => {
        let ctx: TestContext;
        let verifier: ArcadeItemsVerifier;

        beforeEach(async () => {
            ctx = await loadFixture(fixture);
            verifier = <ArcadeItemsVerifier>await deploy("ArcadeItemsVerifier", ctx.signers[0], []);
        });

        it("Reverts if the collateralAddress does not fit the vault factory interface", async () => {
            const { originationController, mockERC20, mockERC721, user: lender, other: borrower } = ctx;

            const tokenId = await mint721(mockERC721, borrower);

            const loanTerms = createLoanTerms(mockERC20.address, mockERC721.address, { collateralId: tokenId });

            const signatureItems: SignatureItem[] = [
                {
                    cType: 0,
                    asset: mockERC721.address,
                    tokenId,
                    amount: 0, // not used for 721
                },
            ];

            const predicates: ItemsPredicate[] = [
                {
                    verifier: verifier.address,
                    data: encodeSignatureItems(signatureItems),
                },
            ];

            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanItemsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                encodePredicates(predicates),
                lender,
                "2",
            );

            await expect(
                originationController
                    .connect(borrower)
                    .initializeLoanWithItems(
                        loanTerms,
                        await borrower.getAddress(),
                        await lender.getAddress(),
                        sig,
                        predicates,
                    ),
            ).to.be.revertedWith("function selector was not recognized and there's no fallback function");
        });

        it("Reverts if the required predicates fail", async () => {
            const { originationController, mockERC20, mockERC721, vaultFactory, user: lender, other: borrower } = ctx;

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const tokenId = await mint721(mockERC721, borrower);
            // Do not transfer erc721 to bundle

            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            const signatureItems: SignatureItem[] = [
                {
                    cType: 0,
                    asset: mockERC721.address,
                    tokenId,
                    amount: 0, // not used for 721
                },
            ];

            const predicates: ItemsPredicate[] = [
                {
                    verifier: verifier.address,
                    data: encodeSignatureItems(signatureItems),
                },
            ];

            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanItemsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                encodePredicates(predicates),
                lender,
                "2",
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
            await expect(
                originationController
                    .connect(borrower)
                    .initializeLoanWithItems(
                        loanTerms,
                        await borrower.getAddress(),
                        await lender.getAddress(),
                        sig,
                        predicates,
                    ),
            ).to.be.revertedWith("predicate failed");
        });

        it("Initalizes a loan with a signature from the lender", async () => {
            const { originationController, mockERC20, mockERC721, vaultFactory, user: lender, other: borrower } = ctx;

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const bundleAddress = await vaultFactory.instanceAt(bundleId);
            const tokenId = await mint721(mockERC721, borrower);
            await mockERC721.connect(borrower).transferFrom(borrower.address, bundleAddress, tokenId);

            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            const signatureItems: SignatureItem[] = [
                {
                    cType: 0,
                    asset: mockERC721.address,
                    tokenId,
                    amount: 0, // not used for 721
                },
            ];

            const predicates: ItemsPredicate[] = [
                {
                    verifier: verifier.address,
                    data: encodeSignatureItems(signatureItems),
                },
            ];

            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanItemsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                encodePredicates(predicates),
                lender,
                "2",
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
            await expect(
                originationController
                    .connect(borrower)
                    .initializeLoanWithItems(
                        loanTerms,
                        await borrower.getAddress(),
                        await lender.getAddress(),
                        sig,
                        predicates,
                    ),
            )
                .to.emit(mockERC20, "Transfer")
                .withArgs(await lender.getAddress(), originationController.address, loanTerms.principal);
        });

        it("Initalizes a loan with a signature from the borrower", async () => {
            const { originationController, mockERC20, mockERC721, vaultFactory, user: lender, other: borrower } = ctx;

            const bundleId = await initializeBundle(vaultFactory, borrower);
            const bundleAddress = await vaultFactory.instanceAt(bundleId);
            const tokenId = await mint721(mockERC721, borrower);
            await mockERC721.connect(borrower).transferFrom(borrower.address, bundleAddress, tokenId);

            const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
            const signatureItems: SignatureItem[] = [
                {
                    cType: 0,
                    asset: mockERC721.address,
                    tokenId,
                    amount: 0, // not used for 721
                },
            ];

            const predicates: ItemsPredicate[] = [
                {
                    verifier: verifier.address,
                    data: encodeSignatureItems(signatureItems),
                },
            ];

            await mint(mockERC20, lender, loanTerms.principal);

            const sig = await createLoanItemsSignature(
                originationController.address,
                "OriginationController",
                loanTerms,
                encodePredicates(predicates),
                borrower,
                "2",
            );

            await approve(mockERC20, lender, originationController.address, loanTerms.principal);
            await vaultFactory.connect(borrower).approve(originationController.address, bundleId);
            await expect(
                originationController
                    .connect(lender)
                    .initializeLoanWithItems(
                        loanTerms,
                        await borrower.getAddress(),
                        await lender.getAddress(),
                        sig,
                        predicates,
                    ),
            )
                .to.emit(mockERC20, "Transfer")
                .withArgs(await lender.getAddress(), originationController.address, loanTerms.principal);
        });

        describe("initializeLoanWithCollateralPermitAndItems", () => {
            it("Reverts if vaultFactory.permit is invalid", async () => {
                const {
                    originationController,
                    vaultFactory,
                    user: lender,
                    other: borrower,
                    mockERC20,
                    mockERC721,
                    lenderPromissoryNote,
                    borrowerPromissoryNote,
                } = ctx;

                const bundleId = await initializeBundle(vaultFactory, borrower);
                const bundleAddress = await vaultFactory.instanceAt(bundleId);
                const tokenId = await mint721(mockERC721, borrower);
                await mockERC721.connect(borrower).transferFrom(borrower.address, bundleAddress, tokenId);

                const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
                const signatureItems: SignatureItem[] = [
                    {
                        cType: 0,
                        asset: mockERC721.address,
                        tokenId,
                        amount: 0, // not used for 721
                    },
                ];

                const predicates: ItemsPredicate[] = [
                    {
                        verifier: verifier.address,
                        data: encodeSignatureItems(signatureItems),
                    },
                ];

                await mint(mockERC20, lender, loanTerms.principal);

                // invalid signature because tokenId is something random here
                const permitData = {
                    owner: await lender.getAddress(),
                    spender: originationController.address,
                    tokenId: 1234,
                    nonce: 0,
                    deadline: maxDeadline,
                };

                const collateralSig = await createPermitSignature(
                    vaultFactory.address,
                    await vaultFactory.name(),
                    permitData,
                    lender,
                );

                const sig = await createLoanItemsSignature(
                    originationController.address,
                    "OriginationController",
                    loanTerms,
                    encodePredicates(predicates),
                    lender,
                    "2",
                );

                await expect(
                    originationController
                        .connect(lender)
                        .initializeLoanWithCollateralPermitAndItems(
                            loanTerms,
                            lenderPromissoryNote.address,
                            borrowerPromissoryNote.address,
                            sig,
                            collateralSig,
                            maxDeadline,
                            predicates,
                        ),
                ).to.be.revertedWith("ERC721Permit: not owner");
            });

            it("Initializes a loan with permit", async () => {
                const {
                    originationController,
                    vaultFactory,
                    user: lender,
                    other: borrower,
                    mockERC20,
                    mockERC721,
                    lenderPromissoryNote,
                    borrowerPromissoryNote,
                } = ctx;

                const bundleId = await initializeBundle(vaultFactory, borrower);
                const bundleAddress = await vaultFactory.instanceAt(bundleId);
                const tokenId = await mint721(mockERC721, borrower);
                await mockERC721.connect(borrower).transferFrom(borrower.address, bundleAddress, tokenId);

                const loanTerms = createLoanTerms(mockERC20.address, vaultFactory.address, { collateralId: bundleId });
                const signatureItems: SignatureItem[] = [
                    {
                        cType: 0,
                        asset: mockERC721.address,
                        tokenId,
                        amount: 0, // not used for 721
                    },
                ];

                const predicates: ItemsPredicate[] = [
                    {
                        verifier: verifier.address,
                        data: encodeSignatureItems(signatureItems),
                    },
                ];

                await mint(mockERC20, lender, loanTerms.principal);

                // invalid signature because tokenId is something random here
                const permitData = {
                    owner: await borrower.getAddress(),
                    spender: originationController.address,
                    tokenId: bundleId,
                    nonce: 0,
                    deadline: maxDeadline,
                };

                const collateralSig = await createPermitSignature(
                    vaultFactory.address,
                    await vaultFactory.name(),
                    permitData,
                    lender,
                );

                const sig = await createLoanItemsSignature(
                    originationController.address,
                    "OriginationController",
                    loanTerms,
                    encodePredicates(predicates),
                    lender,
                    "2",
                );

                await expect(
                    originationController
                        .connect(lender)
                        .initializeLoanWithCollateralPermitAndItems(
                            loanTerms,
                            lenderPromissoryNote.address,
                            borrowerPromissoryNote.address,
                            sig,
                            collateralSig,
                            maxDeadline,
                            predicates,
                        ),
                ).to.be.revertedWith("ERC721Permit: not owner");
            });
        });
    });
});
