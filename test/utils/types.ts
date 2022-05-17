import { BigNumber, BigNumberish } from "ethers";

export enum LoanState {
    DUMMY = 0,
    Created = 1,
    Active = 2,
    Repaid = 3,
    Defaulted = 4,
}

export interface SignatureItem {
    cType: 0 | 1 | 2;
    asset: string;
    tokenId: BigNumberish;
    amount: BigNumber;
}

export interface ItemsPredicate {
    data: string;
    verifier: string;
}

export interface LoanTerms {
    durationSecs: BigNumber;
    principal: BigNumber;
    interestRate: BigNumber;
    collateralAddress: string;
    collateralId: BigNumberish;
    payableCurrency: string;
    numInstallments: BigNumberish;
}

export interface ItemsPayload {
    durationSecs: BigNumberish;
    principal: BigNumber;
    interestRate: BigNumber;
    collateralAddress: string;
    itemsHash: string;
    payableCurrency: string;
    numInstallments: BigNumberish;
    nonce: BigNumberish;
}

export interface LoanData {
    terms: LoanTerms;
    borrowerNoteId: BigNumber;
    lenderNoteId: BigNumber;
    state: LoanState;
    dueDate: BigNumberish;
    startDate: BigNumberish;
    balance: BigNumber;
    balancePaid: BigNumber;
    lateFeesAccrued: BigNumber;
}
