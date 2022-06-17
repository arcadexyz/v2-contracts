import { execSync } from "child_process";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
    NETWORK,
    getLatestDeployment
} from "./utils";

import {
    VaultFactory
} from "../../typechain";

/**
 * Note: Against normal conventions, these tests are interdependent and meant
 * to run sequentially. Each subsequent test relies on the state of the previous.
 */

describe("Deployment", () => {

    describe("creates a prod-ready protocol deployment, end-to-end", () => {
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
            expect(await factoryProxy.getTemplate()).to.eq(deployment["AssetVault"].contractAddress);
            expect(await factoryProxy.whitelist()).to.eq(deployment["CallWhitelist"].contractAddress);
            expect(await factoryImpl.template()).to.be.undefined;
            expect(await factoryImpl.whitelist()).to.be.undefined;

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
            expect(deployment["LenderNote"].constructorArgs[1]).to.eq("aBN");

            expect(deployment["LoanCore"]).to.exist;
            expect(deployment["LoanCore"].contractAddress).to.exist;
            expect(deployment["LoanCore"].contractImplementationAddress).to.exist;
            expect(deployment["LoanCore"].constructorArgs.length).to.eq(0);

            // Make sure LoanCore initialized correctly

            expect(deployment["RepaymentController"]).to.exist;
            expect(deployment["RepaymentController"].contractAddress).to.exist;
            expect(deployment["RepaymentController"].constructorArgs.length).to.eq(1);
            expect(deployment["RepaymentController"].constructorArgs[0]).to.eq(deployment["LoanCore"].contractAddress);

            expect(deployment["OriginationController"]).to.exist;
            expect(deployment["OriginationController"].contractAddress).to.exist;
            expect(deployment["OriginationController"].contractImplementationAddress).to.exist;
            expect(deployment["OriginationController"].constructorArgs.length).to.eq(0);

            // Make sure OriginationController initialized correctly

        });

        it("correctly sets up all roles and permissions");
        it("verifies all contracts on the proper network");

        it("can run sample loans")
    });
});