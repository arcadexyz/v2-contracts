import fs from "fs";
import path from "path";
import { exec, execSync } from "child_process";
import { expect } from "chai";
import hre from "hardhat";

import { main as deploy } from "../../scripts/deploy/deploy";
import { main as setupRoles } from "../../scripts/utils/setup-roles";
import { main as verifyContracts } from "../../scripts/verify-contracts";
import { main as bootstrap } from "../../scripts/bootstrap-state-with-loans";

const ROOT_DIR = path.join(__dirname, "../../");

/**
 * Note: Against normal conventions, these tests are interdependent and meant
 * to run sequentially. Each subsequent test relies on the state of the previous.
 */

describe("Deployment", () => {
    const NETWORK = hre.network.name;
    const DEPLOYMENTS_DIR = path.join(ROOT_DIR, ".deployments", NETWORK);

    describe("creates a prod-ready protocol deployment, end-to-end", () => {
        it("deploys the contracts and creates the correct artifacts", async () => {
            // Deploy everything, via command-line
            execSync(`npx hardhat --network ${NETWORK} run scripts/deploy/deploy.ts`);

            // Make sure JSON file exists
            const files = fs.readdirSync(DEPLOYMENTS_DIR);
            expect(files.length).to.be.gt(0);

            const deployment = files.slice(1).reduce((result, file) => {
                const stats = fs.statSync(path.join(DEPLOYMENTS_DIR, file));

                if (stats.ctime > result.ctime) {
                    result = {
                        filename: file,
                        ctime: stats.ctime
                    };
                }

                return result;
            }, {
                filename: files[0],
                ctime: fs.statSync(path.join(DEPLOYMENTS_DIR, files[0])).ctime
            });

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


        });

        it("correctly sets up all roles and permissions");
        it("verifies all contracts on the proper network");

        it("can run sample loans")
    });
});