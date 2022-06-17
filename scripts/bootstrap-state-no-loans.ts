
import { deployAssets } from "./utils/deploy-assets";
import { mintAndDistribute } from "./utils/mint-distribute-assets";
import { SECTION_SEPARATOR } from "./utils/constants";

export async function main(): Promise<void> {

    console.log(SECTION_SEPARATOR);
    console.log("Deploying resources...\n");
    // Mint some NFTs
    const { punks, art, beats, weth, pawnToken, usd } = await deployAssets();

    console.log(SECTION_SEPARATOR);
    console.log("Minting and Distributing assets...\n");
    // Distribute NFTs and mint ERC20s
    await mintAndDistribute(weth, pawnToken, usd, punks, art, beats);
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
