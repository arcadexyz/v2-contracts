import fs from "fs";
import path from "path";
import hre, { ethers } from "hardhat";
import { expect } from "chai";

export const NETWORK = hre.network.name;
export const ROOT_DIR = path.join(__dirname, "../../");
export const DEPLOYMENTS_DIR = path.join(ROOT_DIR, ".deployments", NETWORK);

export const getLatestDeployment = (): Record<string, any> => {
    // Make sure JSON file exists
    const files = fs.readdirSync(DEPLOYMENTS_DIR);
    expect(files.length).to.be.gt(0);

    const { filename } = files.slice(1).reduce((result, file) => {
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

    const fileData = fs.readFileSync(path.join(DEPLOYMENTS_DIR, filename), 'utf-8');
    const deployment = JSON.parse(fileData);

    return deployment;
}

export const expectDeployedProxy = async (proxyAddress: string): Promise<void> => {
    const proxy = await ethers.getContractAt("ERC1967UpgradeUpgradeable", proxyAddress);
    const implSlot = await proxy.proxiableUUID();

    console.log("Slot", implSlot);

    expect(implSlot).to.not.be.undefined;
}