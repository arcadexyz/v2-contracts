import "@typechain/hardhat";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";

import "./tasks/hardhat-accounts";
import "./tasks/account";
import "./tasks/clean";
import "./tasks/functions/generate";
import "hardhat-deploy";

import { resolve } from "path";

import { config as dotenvConfig } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import { NetworkUserConfig, HardhatNetworkUserConfig } from "hardhat/types";
import { removeConsoleLog } from 'hardhat-preprocessor';

import { getMnemonic } from './tasks/functions/mnemonic';

dotenvConfig({ path: resolve(__dirname, "./.env") });
// TARGET NETWIORK
console.log('HARDHAT_TARGET_NETWORK: ', process.env.HARDHAT_TARGET_NETWORK);

const chainIds = {
    ganache: 1337,
    goerli: 5,
    hardhat: 1337,
    localhost: 31337,
    kovan: 42,
    mainnet: 1,
    rinkeby: 4,
    ropsten: 3,
};

// get mnumonic
let mnemonic: string;
mnemonic = getMnemonic();
// fork mainnet?
const forkMainnet = process.env.FORK_MAINNET;
// api key?
let alchemyApiKey: string | undefined;
if (forkMainnet && !process.env.ALCHEMY_API_KEY) {
    throw new Error("Please set process.env.ALCHEMY_API_KEY");
} else {
    alchemyApiKey = process.env.ALCHEMY_API_KEY;
}
// create testnet network
function createTestnetConfig(network: keyof typeof chainIds): NetworkUserConfig {
    const url = `https://eth-${network}.alchemyapi.io/v2/${alchemyApiKey}`;
    return {
        accounts: {
            count: 10,
            initialIndex: 0,
            mnemonic,
            path: "m/44'/60'/0'/0", // HD derivation path
        },
        chainId: chainIds[network],
        url,
    };
}
// create local network config
function createHardhatConfig(): HardhatNetworkUserConfig {
    const config = {
        defaultNetwork: "hardhat",
        accounts: {
            mnemonic,
        },
        allowUnlimitedContractSize: true,
        chainId: chainIds.hardhat,
        gasMultiplier: 10,
        contractSizer: {
            alphaSort: true,
            disambiguatePaths: false,
            runOnCompile: true,
            strict: true,
            only: [":ERC20$"],
        },
    };

    if (forkMainnet) {
        return Object.assign(config, {
            forking: {
                url: `https://eth-mainnet.alchemyapi.io/v2/${alchemyApiKey}`,
                //blockNumber: 14390000
            },
        });
    }

    return config;
}
// create mainnet network config
function createMainnetConfig(): NetworkUserConfig {
    return {
        accounts: {
            mnemonic,
        },
        chainId: chainIds.mainnet,
        url: `https://eth-mainnet.alchemyapi.io/v2/${alchemyApiKey}`,
        gas: 21000, // gas limit for a tx, 21000 wei is the minimum for tx to enter mempool
        gasPrice: 60000000000, // current gas price, 60 gwei
    };
}

const optimizerEnabled = process.env.DISABLE_OPTIMIZER ? false : true;

const config: HardhatUserConfig = {
    //https://github.com/wighawag/hardhat-deploy/issues/63
    preprocess: {
      eachLine: removeConsoleLog((hre) => hre.network.name !== 'hardhat' && hre.network.name !== 'localhost'),
    },
    defaultNetwork: process.env.HARDHAT_TARGET_NETWORK,
    namedAccounts: {
        deployer: 0,
    },
    gasReporter: {
        currency: "USD",
        enabled: process.env.REPORT_GAS ? true : false,
        excludeContracts: [],
        src: "./contracts",
        coinmarketcap: process.env.COINMARKETCAP_API_KEY,
        outputFile: process.env.REPORT_GAS_OUTPUT,
    },
    networks: {
        mainnet: createMainnetConfig(),
        hardhat: createHardhatConfig(),
        goerli: createTestnetConfig("goerli"),
        kovan: createTestnetConfig("kovan"),
        rinkeby: createTestnetConfig("rinkeby"),
        ropsten: createTestnetConfig("ropsten"),
        localhost: {
            chainId: chainIds.localhost,
            url: 'http://localhost:8545',
            gasMultiplier: 10,
        },
    },
    paths: {
        artifacts: "./artifacts",
        cache: "./cache",
        sources: "./contracts",
        deployments: './deployments',
        deploy: './deploy',
        imports: 'imports',
        tests: "./test",
    },
    solidity: {
        compilers: [
            {
                version: "0.8.11",
                settings: {
                    metadata: {
                        // Not including the metadata hash
                        // https://github.com/paulrberg/solidity-template/issues/31
                        bytecodeHash: "none",
                    },
                    // You should disable the optimizer when debugging
                    // https://hardhat.org/hardhat-network/#solidity-optimizer-support
                    optimizer: {
                        enabled: optimizerEnabled,
                        runs: 200,
                    },
                },
            },
            {
                version: "0.4.12",
            },
        ],
    },
    typechain: {
        outDir: "typechain",
        target: "ethers-v5",
    },
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
};

export default config;
