/* eslint no-unused-vars: 0 */

import { ethers } from "hardhat";

import {
    ERC721,
    LoanCore,
    PromissoryNote
} from "../typechain";

/**
 * This script checks ownership by the borrower of a collateralized
 * NFT - for example, for Discord token-gated access à la Collab.land.
 *
 * If this script returns true, it means that the user in question (the USER parameter)
 * is currently borrowing against the specified NFT (the NFT parameter). This means
 * that they own the NFT and should pass any token-gated access.
 *
 * The BorrowerNote (BORROWER_NOTE_ADDRESS) contract is the ERC721 representing
 * a borrower's obligation in a loan. The LoanCore (LOAN_CORE_ADDRESS) contract
 * is the main lending protocol contract, which stores data for each open loan.
 * The VaultFactory (VAULT_FACTORY_ADDRESS) is an ERC721 tracking ownership of asset
 * vaults, which are smart contracts which can hold "bundles" of multiple items
 * of collateral. Each asset vault is its own smart contract whose address is
 * equal to the token ID tracked in the vault factory.
 */
export async function main(
    USER_ADDRESS: string,
    NFT_ADDRESS: string,
    BORROWER_NOTE_ADDRESS: string,
    LOAN_CORE_ADDRESS: string,
    VAULT_FACTORY_ADDRESS: string
): Promise<boolean> {
    const noteFactory = await ethers.getContractFactory("PromissoryNote");
    const borrowerNote = <PromissoryNote>await noteFactory.attach(BORROWER_NOTE_ADDRESS);

    const loanCoreFactory = await ethers.getContractFactory("LoanCore");
    const loanCore = <LoanCore>await loanCoreFactory.attach(LOAN_CORE_ADDRESS);

    const nftFactory = await ethers.getContractFactory("ERC721");
    const nft = <ERC721>await nftFactory.attach(NFT_ADDRESS);

    // First, check if user has any open loans as a borrower.
    const numOpenLoans = (await borrowerNote.balanceOf(USER_ADDRESS)).toNumber();

    // If no loans, then they can't be borrowing against the NFT.
    if (numOpenLoans == 0) return false;

    // If they have loans, check the collateral for each loan.
    for (let i = 0; i < numOpenLoans; i++) {
        // Get the data structure containing the address and token ID of the collateral.
        const loanId = await borrowerNote.tokenOfOwnerByIndex(USER_ADDRESS, i);
        const { terms } = await loanCore.getLoan(loanId);

        if (terms.collateralAddress === NFT_ADDRESS) {
            // This NFT is being used directly as collateral.
            return true;
        } else if (terms.collateralAddress === VAULT_FACTORY_ADDRESS) {
            // This loan has bundled collateral, so we should
            // compute the address of the relevant asset vault contract.
            // We simply convert the token ID into a hex string.
            const vaultAddress = `0x${terms.collateralId.toHexString()}`;

            // If the vault owns the NFT, the borrower is borrowing against it.
            const vaultNftBalance = await nft.balanceOf(vaultAddress);
            if (vaultNftBalance.gt(0)) return true;
        }

        // This loan is not using the NFT as collateral, so check the borrower's
        // next loan.
    }

    return false;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
// if (require.main === module) {
//     main()
//         .then(() => process.exit(0))
//         .catch((error: Error) => {
//             console.error(error);
//             process.exit(1);
//         });
// }
