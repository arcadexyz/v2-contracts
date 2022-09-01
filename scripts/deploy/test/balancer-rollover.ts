import { execSync } from "child_process";
import { expect } from "chai";
import { ethers, artifacts } from "hardhat";
import assert from "assert";

import {
    NETWORK,
    IS_MAINNET_FORK
} from "./utils";

import {
    ORIGINATOR_ROLE,
    ADMIN_ROLE,
    FEE_CLAIMER_ROLE,
    REPAYER_ROLE,
} from "../../utils/constants";

import { ZERO_ADDRESS } from "../../../test/utils/erc20";

import {
    CallWhitelist,
    FeeController,
    LoanCore,
    PromissoryNote,
    OriginationController,
    VaultFactory
} from "../../../typechain";

/**
 * Note: this test requires full mainnet fork context, so we can pull in the V1 protocol
 * without having to redeploy everything.
 */
assert(NETWORK === "hardhat" && IS_MAINNET_FORK, "Must use a mainnet fork!");

const VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

describe("Deployment", function () {
    this.timeout(0);
    this.bail();

    let rollover: BalancerFlashRolloverV1toV2;

    it("deploys rollover contracts", async () => {
    })

    it("starts a loan on the V1 protocol", async () => {

    });

    it("rolls the loan over from V1 to V2, using balancer", async () => {

    })
});