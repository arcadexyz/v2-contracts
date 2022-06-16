import { ethers } from "hardhat";
<<<<<<< HEAD
=======
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";
>>>>>>> 81cc979 (fix(bootstrap-state): removed new protocol deployment + added nonce to bootstrap-state-no-loans.ts)
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { MockERC1155Metadata, MockERC20, MockERC721Metadata } from "../../typechain";
import { getBalance, mintTokens } from "./tokens";
import { mintNFTs } from "./nfts";
<<<<<<< HEAD
import { SUBSECTION_SEPARATOR } from "./constants";
import { config } from "./../../hardhat.config";
=======
import { SUBSECTION_SEPARATOR } from "./bootstrap-tools";
>>>>>>> 81cc979 (fix(bootstrap-state): removed new protocol deployment + added nonce to bootstrap-state-no-loans.ts)

dotenvConfig({ path: resolve(__dirname, "../../.env") });

export async function mintAndDistribute(
    weth: MockERC20,
    pawnToken: MockERC20,
    usd: MockERC20,
    punks: MockERC721Metadata,
    art: MockERC721Metadata,
    beats: MockERC1155Metadata,
): Promise<void> {
<<<<<<< HEAD
<<<<<<< HEAD
    // Bootstrap five accounts, skip the first account, since the
    // first signer will be the deployer account in hardhat.config.
    let signers: SignerWithAddress[] = await ethers.getSigners();
    signers = (await ethers.getSigners()).slice(0, 6);
=======
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
=======
>>>>>>> 3d8a8ef (generate and fund child wallet scripts done)

    // Give a bunch of everything to signer[0]
    await mintTokens(signers[0].address, [1000, 500000, 2000000], weth, pawnToken, usd);
    await mintNFTs(signers[0].address, [20, 20, 20, 20], punks, art, beats);

    // Give a mix to signers[1] through signers[4]
    await mintTokens(signers[1].address, [0, 2000, 10000], weth, pawnToken, usd);
    await mintNFTs(signers[1].address, [5, 0, 2, 1], punks, art, beats);

    await mintTokens(signers[2].address, [450, 350.5, 5000], weth, pawnToken, usd);
    await mintNFTs(signers[2].address, [0, 0, 1, 0], punks, art, beats);

    await mintTokens(signers[3].address, [2, 50000, 7777], weth, pawnToken, usd);
    await mintNFTs(signers[3].address, [10, 3, 7, 0], punks, art, beats, );

<<<<<<< HEAD
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintTokens(signers[4].address, [50, 2222.2, 12.1], weth, pawnToken, usd, { nonce: nonce_counter });
    nonce_counter++;
    if (DEBUG_NONCE) console.log("CURRENT NONCE:", nonce_counter);
    await mintNFTs(signers[4].address, [1, 12, 1, 6], punks, art, beats, { nonce: nonce_counter });
>>>>>>> 81cc979 (fix(bootstrap-state): removed new protocol deployment + added nonce to bootstrap-state-no-loans.ts)

    // Give a bunch of everything to signer[0]
    console.log(SUBSECTION_SEPARATOR);
    await mintTokens(signers[1].address, [1000, 500000, 2000000], weth, pawnToken, usd);
    await mintNFTs(signers[1].address, [5, 5, 5, 5], punks, art, beats);
    console.log("1). " + signers[1].address + " minted tokens and NFTs")

    // Give a mix to signers[1] through signers[4]
    await mintTokens(signers[2].address, [0, 2000, 10000], weth, pawnToken, usd);
    await mintNFTs(signers[2].address, [5, 0, 2, 1], punks, art, beats);
    console.log("2). " + signers[2].address + " minted tokens and NFTs")

    await mintTokens(signers[3].address, [450, 350.5, 5000], weth, pawnToken, usd);
    await mintNFTs(signers[3].address, [0, 0, 1, 0], punks, art, beats);
    console.log("3). " + signers[3].address + " minted tokens and NFTs")

    await mintTokens(signers[4].address, [2, 50000, 7777], weth, pawnToken, usd);
    await mintNFTs(signers[4].address, [5, 3, 7, 0], punks, art, beats, );
    console.log("4). " + signers[4].address + " minted tokens and NFTs")

    await mintTokens(signers[5].address, [50, 2222.2, 12.1], weth, pawnToken, usd);
    await mintNFTs(signers[5].address, [1, 5, 1, 5], punks, art, beats);
    console.log("5). " + signers[5].address + " minted tokens and NFTs")
    console.log(SUBSECTION_SEPARATOR);
=======
    await mintTokens(signers[4].address, [50, 2222.2, 12.1], weth, pawnToken, usd);
    await mintNFTs(signers[4].address, [1, 12, 1, 6], punks, art, beats);
>>>>>>> 3d8a8ef (generate and fund child wallet scripts done)

    // log the current balances of signers 1-5
    console.log("Initial balances:");
    for (let i = 1; i < signers.length; i++) {
        const signer = signers[i];
        const { address: signerAddr } = signer;

        console.log(SUBSECTION_SEPARATOR);
        console.log(`Signer ${i}: ${signerAddr}`);
        console.log("PawnPunks balance:", await getBalance(punks, signerAddr));
        console.log("PawnArt balance:", await getBalance(art, signerAddr));
<<<<<<< HEAD
        console.log("PawnBeats Edition 0 balance:", (await beats.balanceOf(signerAddr, 0)).toString());
        console.log("PawnBeats Edition 1 balance:", (await beats.balanceOf(signerAddr, 1)).toString());
=======
        console.log("PawnBeats Edition 0 balance:", await (await (beats.balanceOf(signerAddr, 0))).toString());
        console.log("PawnBeats Edition 1 balance:", await (await (beats.balanceOf(signerAddr, 1))).toString());
>>>>>>> 81cc979 (fix(bootstrap-state): removed new protocol deployment + added nonce to bootstrap-state-no-loans.ts)
        console.log("ETH balance:", (await signer.getBalance()).toString());
        console.log("WETH balance:", await getBalance(weth, signerAddr));
        console.log("PAWN balance:", await getBalance(pawnToken, signerAddr));
        console.log("PUSD balance:", await getBalance(usd, signerAddr));
    }
}
