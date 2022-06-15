import { ethers } from "hardhat";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { MockERC1155Metadata, MockERC20, MockERC721Metadata } from "../../typechain";

import { getBalance, mintTokens } from "./tokens";
import { mintNFTs } from "./nfts";
import { SUBSECTION_SEPARATOR } from "./bootstrap-tools";

dotenvConfig({ path: resolve(__dirname, "../../.env") });

// nonce debug toggle
const DEBUG_NONCE = false;

export async function mintAndDistribute(
    signers: SignerWithAddress[],
    weth: MockERC20,
    pawnToken: MockERC20,
    usd: MockERC20,
    punks: MockERC721Metadata,
    art: MockERC721Metadata,
    beats: MockERC1155Metadata,
): Promise<void> {
    // deployer address from .env
    let deployerAddr: string;
    if(process.env.ARCADE_DEPLOYER_ADDRESS) {
      deployerAddr = process.env.ARCADE_DEPLOYER_ADDRESS;
    } else {
      throw new Error("ADDRESS environment variable is not set.")
    }

    // get deployer accounts current transaction count to create the nonce
    // upgradeable contracts using deployProxy do have a custom nonce added to them
    let nonce_counter = await ethers.provider.getTransactionCount(deployerAddr);

    // Give a bunch of everything to signer[0]
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintTokens(signers[0].address, [1000, 500000, 2000000], weth, pawnToken, usd, { nonce: nonce_counter });
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintNFTs(signers[0].address, [20, 20, 20, 20], punks, art, beats, { nonce: nonce_counter });

    // Give a mix to signers[1] through signers[5]
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintTokens(signers[1].address, [0, 2000, 10000], weth, pawnToken, usd, { nonce: nonce_counter });
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintNFTs(signers[1].address, [5, 0, 2, 1], punks, art, beats, { nonce: nonce_counter });

    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintTokens(signers[2].address, [450, 350.5, 5000], weth, pawnToken, usd, { nonce: nonce_counter });
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintNFTs(signers[2].address, [0, 0, 1, 0], punks, art, beats, { nonce: nonce_counter });

    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintTokens(signers[3].address, [2, 50000, 7777], weth, pawnToken, usd, { nonce: nonce_counter });
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintNFTs(signers[3].address, [10, 3, 7, 0], punks, art, beats, { nonce: nonce_counter });

    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintTokens(signers[4].address, [50, 2222.2, 12.1], weth, pawnToken, usd, { nonce: nonce_counter });
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintNFTs(signers[4].address, [1, 12, 1, 6], punks, art, beats, { nonce: nonce_counter });

    console.log("Initial balances:");
    for (const i in signers) {
        const signer = signers[i];
        const { address: signerAddr } = signer;

        console.log(SUBSECTION_SEPARATOR);
        console.log(`Signer ${i}: ${signerAddr}`);
        console.log("PawnPunks balance:", await getBalance(punks, signerAddr));
        console.log("PawnArt balance:", await getBalance(art, signerAddr));
        console.log("PawnBeats Edition 0 balance:", await (await (beats.balanceOf(signerAddr, 0))).toString());
        console.log("PawnBeats Edition 1 balance:", await (await (beats.balanceOf(signerAddr, 1))).toString());
        console.log("ETH balance:", (await signer.getBalance()).toString());
        console.log("WETH balance:", await getBalance(weth, signerAddr));
        console.log("PAWN balance:", await getBalance(pawnToken, signerAddr));
        console.log("PUSD balance:", await getBalance(usd, signerAddr));
    }
}
