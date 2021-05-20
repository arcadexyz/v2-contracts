/* eslint-disable */
// TODO: Remove the disable above.

import { expect } from "chai";
import hre from "hardhat";
import { BigNumber, BigNumberish} from "ethers";
import { deploy } from "./utils/contracts";

import { OriginationController, AssetWrapper, PromissoryNote, MockLoanCore} from "../typechain";
import { ZERO_ADDRESS } from "./utils/erc1155";
import { fromRpcSig } from "ethereumjs-util";

type Signer = SignerWithAddress;

interface TestContext {
  originationController: OriginationController;
  assetWrapper: AssetWrapper;
  lenderPromissoryNote: PromissoryNote;
  borrowerPromissoryNote: PromissoryNote;
  loanCore : MockLoanCore;
  user: Signer;
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

const chainId = hre.network.config.chainId!;
const maxDeadline = hre.ethers.constants.MaxUint256;

const initializeBundle = async (AssetWrapper: AssetWrapper, user: Signer): Promise<BigNumber> => {
  const tx = await AssetWrapper.connect(user).initializeBundle(await user.getAddress());
  const receipt = await tx.wait();

  if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
    return receipt.events[0].args.tokenId;
  } else {
    throw new Error("Unable to initialize bundle");
  }
};



const setupTestContext = async() : Promise<TestContext> => {

  const signers: Signer[] = await hre.ethers.getSigners();
  const loanCore = <MockLoanCore>await deploy("MockLoanCore", signers[0], []);
  const assetWrapper = <AssetWrapper>await deploy("AssetWrapper", signers[0], ["AssetWrapper", "WRP"]);

  const originationController = <OriginationController> await deploy("OriginationController", signers[0], [loanCore.address]);

  return {
    originationController,
    assetWrapper,
    lenderPromissoryNote,
    borrowerPromissoryNote,
    loanCore,
    user: signers[0],
    other: signers[1],
    signers: signers.slice(2),
  };
}

const createLoanTerms = (
  payableCurrency: string,
  {
    dueDate = new Date(new Date().getTime() + 3600000).getTime(),
    principal = hre.ethers.utils.parseEther("100"),
    interest = hre.ethers.utils.parseEther("1"),
    collateralTokenId = BigNumber.from(1),
  }: Partial<LoanTerms> = {},
): LoanTerms => {
  return {
    dueDate,
    principal,
    interest,
    collateralTokenId,
    payableCurrency,
  };
};

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

const createLoan = async (loanCore: MockLoanCore, user: Signer, terms: LoanTerms): Promise<BigNumber> => {
  const transaction = await loanCore.connect(user).createLoan(terms);
  const receipt = await transaction.wait();

  if (receipt && receipt.events && receipt.events.length === 1 && receipt.events[0].args) {
    return receipt.events[0].args.loanId;
  } else {
    throw new Error("Unable to initialize loan");
  }
};

const startLoan = async (
  loanCore: MockLoanCore,
  user: Signer,
  lenderNote: PromissoryNote,
  borrowerNote: PromissoryNote,
  loanId: BigNumber,
) => {
  const transaction = await loanCore.connect(user).startLoan(lenderNote.address, borrowerNote.address, loanId);
  await transaction.wait();
};

describe("OriginationController", () => {
  
  describe("constructor", () => {
    it("Reverts if _loanCore address is not provided", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();
      await expect(deploy("OriginationController", signers[0], [ZERO_ADDRESS])).to.be.reverted;
    });
    
    it("Instantiates the OriginationController", async () => {
      const signers: Signer[] = await hre.ethers.getSigners();
      const loanCore = <MockLoanCore>await deploy("MockLoanCore", signers[0], []);
      expect(deploy("OriginationController", signers[0], [loanCore.address]));
    });

  });
    
  describe("initializeLoan", () => {
    it("Reverts if msg.sender is not either lender or borrower", async() => {
      const {originationController, assetWrapper, user, other, lenderPromissoryNote, borrowerPromissoryNote} = await setupTestContext();
      const loanTerms = createLoanTerms(assetWrapper.address);
      const bundleId = await initializeBundle(assetWrapper, user);

      const data = buildData(
        chainId,
        assetWrapper.address,
        await assetWrapper.name(),
        "1",
        await user.getAddress(),
        await other.getAddress(),
        bundleId,
        0,
      );

      const signature = await user._signTypedData(data.domain, data.types, data.message);
      const { v, r, s } = fromRpcSig(signature);
      await expect(originationController.connect(ZERO_ADDRESS).initializeLoan(loanTerms, lenderPromissoryNote.address, borrowerPromissoryNote.address, v, r, s)).to.be.reverted;

    });

    it("Reverts if it has not been approved to accept the collateral token by the borrower", () => {});
    it("Reverts if it has not been approved to accept the funding currency tokens by the lender", () => {});
    it("Initializes a loan", () => {});
  });

  describe("initializeLoanWithCollateralPermit", () => {
    it("Reverts if AssetWrapper.permit is invalid", () => {});
    it("Initializes a loan", () => {});

  });

});
