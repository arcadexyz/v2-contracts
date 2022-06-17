import { execSync } from "child_process";
import { expect } from "chai";
import { ethers } from "hardhat";
import assert from "assert";

import {
    NETWORK,
    getLatestDeployment
} from "./utils";

import { ZERO_ADDRESS } from "../utils/erc20";

import {
    LoanCore,
    OriginationController,
    VaultFactory
} from "../../typechain";

/**
 * Note: Against normal conventions, these tests are interdependent and meant
 * to run sequentially. Each subsequent test relies on the state of the previous.
 */
assert(NETWORK !== "hardhat", "Must use a long-lived network!");

describe("Deployment", function() {
    this.timeout(0);

    it("deploys the contracts and creates the correct artifacts", async () => {
        // Deploy everything, via command-line
        console.log(); // whitespace
        execSync(`npx hardhat --network ${NETWORK} run scripts/deploy/deploy.ts`, { stdio: 'inherit' });

        // Make sure JSON file exists
        const deployment = getLatestDeployment();

        // Make sure deployment artifacts has all the correct contracts specified
        expect(deployment["CallWhitelist"]).to.exist;
        expect(deployment["CallWhitelist"].contractAddress).to.exist;
        expect(deployment["CallWhitelist"].constructorArgs.length).to.eq(0);

        expect(deployment["AssetVault"]).to.exist;
        expect(deployment["AssetVault"].contractAddress).to.exist;
        expect(deployment["AssetVault"].constructorArgs.length).to.eq(0);

        expect(deployment["VaultFactory"]).to.exist;
        expect(deployment["VaultFactory"].contractAddress).to.exist;
        expect(deployment["VaultFactory"].contractImplementationAddress).to.exist;
        expect(deployment["VaultFactory"].constructorArgs.length).to.eq(0);

        // Make sure VaultFactory initialized correctly
        const vaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
        const factoryProxy = <VaultFactory>await vaultFactoryFactory.attach(deployment["VaultFactory"].contractAddress);
        const factoryImpl = <VaultFactory>await vaultFactoryFactory.attach(deployment["VaultFactory"].contractImplementationAddress);

        // Proxy initialized, impl not
        expect(await factoryProxy.template()).to.eq(deployment["AssetVault"].contractAddress);
        expect(await factoryProxy.whitelist()).to.eq(deployment["CallWhitelist"].contractAddress);
        expect(await factoryImpl.template()).to.eq(ZERO_ADDRESS);
        expect(await factoryImpl.whitelist()).to.eq(ZERO_ADDRESS);

        expect(deployment["FeeController"]).to.exist;
        expect(deployment["FeeController"].contractAddress).to.exist;
        expect(deployment["FeeController"].constructorArgs.length).to.eq(0);

        expect(deployment["BorrowerNote"]).to.exist;
        expect(deployment["BorrowerNote"].contractAddress).to.exist;
        expect(deployment["BorrowerNote"].constructorArgs.length).to.eq(2);
        expect(deployment["BorrowerNote"].constructorArgs[0]).to.eq("Arcade.xyz BorrowerNote");
        expect(deployment["BorrowerNote"].constructorArgs[1]).to.eq("aBN");

        expect(deployment["LenderNote"]).to.exist;
        expect(deployment["LenderNote"].contractAddress).to.exist;
        expect(deployment["LenderNote"].constructorArgs.length).to.eq(2);
        expect(deployment["LenderNote"].constructorArgs[0]).to.eq("Arcade.xyz LenderNote");
        expect(deployment["LenderNote"].constructorArgs[1]).to.eq("aLN");

        expect(deployment["LoanCore"]).to.exist;
        expect(deployment["LoanCore"].contractAddress).to.exist;
        expect(deployment["LoanCore"].contractImplementationAddress).to.exist;
        expect(deployment["LoanCore"].constructorArgs.length).to.eq(0);

        // Make sure LoanCore initialized correctly
        const loanCoreFactory = await ethers.getContractFactory("LoanCore");
        const loanCoreProxy = <LoanCore>await loanCoreFactory.attach(deployment["LoanCore"].contractAddress);
        const loanCoreImpl = <LoanCore>await loanCoreFactory.attach(deployment["LoanCore"].contractImplementationAddress);

        // Proxy initialized, impl not
        expect(await loanCoreProxy.feeController()).to.eq(deployment["FeeController"].contractAddress);
        expect(await loanCoreProxy.borrowerNote()).to.eq(deployment["BorrowerNote"].contractAddress);
        expect(await loanCoreProxy.lenderNote()).to.eq(deployment["LenderNote"].contractAddress);
        expect(await loanCoreImpl.feeController()).to.eq(ZERO_ADDRESS);
        expect(await loanCoreImpl.borrowerNote()).to.eq(ZERO_ADDRESS);
        expect(await loanCoreImpl.lenderNote()).to.eq(ZERO_ADDRESS);

        expect(deployment["RepaymentController"]).to.exist;
        expect(deployment["RepaymentController"].contractAddress).to.exist;
        expect(deployment["RepaymentController"].constructorArgs.length).to.eq(1);
        expect(deployment["RepaymentController"].constructorArgs[0]).to.eq(deployment["LoanCore"].contractAddress);

        expect(deployment["OriginationController"]).to.exist;
        expect(deployment["OriginationController"].contractAddress).to.exist;
        expect(deployment["OriginationController"].contractImplementationAddress).to.exist;
        expect(deployment["OriginationController"].constructorArgs.length).to.eq(0);

        // Make sure OriginationController initialized correctly
        const ocFactory = await ethers.getContractFactory("OriginationController");
        const ocProxy = <OriginationController>await ocFactory.attach(deployment["OriginationController"].contractAddress);
        const ocImpl = <OriginationController>await ocFactory.attach(deployment["OriginationController"].contractImplementationAddress);

        expect(await ocProxy.loanCore()).to.eq(deployment["LoanCore"].contractAddress);
        expect(await ocImpl.loanCore()).to.eq(ZERO_ADDRESS);
    });

    it("correctly sets up all roles and permissions");
    it("verifies all contracts on the proper network");

    it("can run sample loans")
});