<<<<<<< HEAD

import { ethers } from "hardhat";

=======
import fs from 'fs';
import hre, { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
>>>>>>> 3d8a8ef (generate and fund child wallet scripts done)
import { deployNFTs } from "./utils/deploy-assets";
import { mintAndDistribute } from "./utils/mint-distribute-assets";
import { SECTION_SEPARATOR } from "./utils/constants";

const generatedFolder = './generated/';
const childAddress:string[] = [];
const addressArray: SignerWithAddress[] = [];

export async function main(): Promise<void> {
<<<<<<< HEAD

=======
>>>>>>> 3d8a8ef (generate and fund child wallet scripts done)
    console.log(SECTION_SEPARATOR);
    console.log("Deploying resources...\n");
    // Mint some NFTs
    const { punks, art, beats, weth, pawnToken, usd } = await deployNFTs();

<<<<<<< HEAD
    console.log(SECTION_SEPARATOR);
    console.log("Minting and Distributing assets...\n");
    // Distribute NFTs and mint ERC20s
    await mintAndDistribute(weth, pawnToken, usd, punks, art, beats);
=======
    // create signers array
    // get file names from generated folder
    fs.readdirSync(generatedFolder).forEach(file => {
        // slice .txt from end of filename string
        let addr = file.split(".txt")[0]
        // add to local array
        childAddress.push(addr);
    });
    // create signers from accounts
    for(let i=0; i < childAddress.length; i++) {
        // read file to get the mnemonic
        let mnemonic = fs.readFileSync("./generated/" + childAddress[i]+".txt", "utf8")

        const network = hre.network;
        const provider = new hre.ethers.providers.AlchemyProvider(network.name)
        let wallet = hre.ethers.Wallet.fromMnemonic(mnemonic);
        let signer = wallet.connect(provider);
        addressArray.push(signer)
    }
    // Use signers to distribute NFTs and mint ERC20s
    console.log(SECTION_SEPARATOR);
    console.log("Minting and Distributing assets...\n");
    await mintAndDistribute(addressArray, weth, pawnToken, usd, punks, art, beats);
>>>>>>> 3d8a8ef (generate and fund child wallet scripts done)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}
