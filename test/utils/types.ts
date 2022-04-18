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
    amount: BigNumberish;
}

export interface ItemsPredicate {
    data: string;
    verifier: string;
}

export interface LoanTerms {
    durationSecs: BigNumberish;
    principal: BigNumber;
    interest: BigNumber;
    collateralAddress: string;
    collateralId: BigNumber;
    payableCurrency: string;
}

export interface ItemsPayload {
    durationSecs: BigNumberish;
    principal: BigNumber;
    interest: BigNumber;
    collateralAddress: string;
    itemsHash: string;
    payableCurrency: string;
}

export interface LoanData {
    terms: LoanTerms;
    borrowerNoteId: BigNumber;
    lenderNoteId: BigNumber;
    state: LoanState;
    dueDate: BigNumberish;
}
