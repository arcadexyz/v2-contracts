/* eslint no-unused-vars: 0 */

import hre, { ethers, upgrades } from "hardhat";
import {
    AssetVault,
    CallWhitelist,
    MockERC20,
    OriginationController,
    PromissoryNote,
    VaultFactory,
    RepaymentController,
    NightmareImpDoor,
} from "../typechain";

import { createVault } from "./utils/vault";
import { LoanTerms } from "../test/utils/types";
import { createLoanTermsSignature } from "../test/utils/eip712";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

/**
 * This script runs 1). mintTricksAndBoxes 2). unlockBoxes 3). mintTreats
 * on the NightmareImp Treasure box contract 0x59775fD5F266C216D7566eB216153aB8863C9c84.
 * 
 * To run this script: 
 * FORK_MAINNET=true npx hardhat run scripts/trick-or-treat-forgotten-runes.ts --network hardhat
 */

export async function main(): Promise<void> {

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////                 GLOBALS                ////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";
    const MAYC = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6";
    const BAKC = "0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623";
    const ETH_WHALE = "0x54BE3a794282C030b15E43aE2bB182E14c409C5e"; // dingaling.eth
    const ARCADE_USER = "0xD48ce884D1F01647eA7D1b1ED50CAD474b39638c"; // arcade user in active loan
    const ARCADE_USER_AV = "0xFE5eA32Aa7471406aE4683e1D5c81eb429B1e0fA"; // vault address in active loan
    const NIGHTMARE_IMP_DOOR = "0xD52c79d897a24c275729112C3C5ea813b5703f88";

    const CALL_WHITELIST = "0xB4496F9798cEbd003c5d5a956B5B8f3933178C82";
    const ORIGINATION_CONTROLLER = "0x4c52ca29388A8A854095Fd2BeB83191D68DC840b";
    const REPAYMENT_CONTROLLER = "0xb39dAB85FA05C381767FF992cCDE4c94619993d4";
    const BORROWER_NOTE = "0x337104A4f06260Ff327d6734C555A0f5d8F863aa";
    const ARCADE_MSIG = "0x398e92C827C5FA0F33F171DC8E20570c5CfF330e";

    const [user1, user2, user3, user4, lender] = await ethers.getSigners();

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [ETH_WHALE],
    });

    const eth_whale = await hre.ethers.getSigner(ETH_WHALE);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////      STEP 1: TOKEN DISTRIBUTION        ////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    await eth_whale.sendTransaction({ to: ARCADE_MSIG, value: ethers.utils.parseEther("0.5") });

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////          STEP 1: CALLWHITELIST         /////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Whitelisting trick or treat functions...");

    // Set up rewards pool
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [ARCADE_MSIG],
    });

    const msig = await hre.ethers.getSigner(ARCADE_MSIG);

    // link in contracts
    const callWhitelistFact = await ethers.getContractFactory("CallWhitelist");
    const callWhitelist = callWhitelistFact.attach(CALL_WHITELIST) as CallWhitelist;
    const nightmareImpDoorFact = await ethers.getContractFactory("NightmareImpDoor");
    const nightmareImpDoor = nightmareImpDoorFact.attach(NIGHTMARE_IMP_DOOR) as NightmareImpDoor;
    const usersAVFact = await ethers.getContractFactory("AssetVault");
    const usersAV = usersAVFact.attach(ARCADE_USER_AV) as AssetVault;

    // Whitelist NightmareImpDoor - mintTricksAndBoxes
    await callWhitelist.connect(msig).add(NIGHTMARE_IMP_DOOR, "0x1a491b52");  

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////          STEP 2: CALLS          ///////////////////////////////////////////s
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Performing trick or treat operation...");

    // Set up rewards pool
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [ARCADE_USER],
    });

    const arcade_user = await hre.ethers.getSigner(ARCADE_USER);

    const components = { 
        partnerContracts: [
            "0x60E4d786628Fea6478F785A6d7e704777c86a7c6"
        ],
        partnerTokenIds: [
            19145
        ],
        isBox: true,
        trickTokenIds: [
            0
        ],
    }

    // sign tx
    const domainData = {
        name: "NightmareImpDoor",
        version: '1',
        "chainId": 1337, // cannot be "1" from mainnet since this is a forked network
        verifyingContract: nightmareImpDoor.address,
    };

    const dataType = [
        {name: "partnerContracts", type: "address[]"},
        {name: "partnerTokenIds", type: "uint256[]"},
        {name: "isBox", type: "bool[]"},
        {name: "trickTokenIds", type: "uint256[]"},
    ];

    const message = [
        [MAYC],
        [19145],
        [true],
        [0],
    ]

    const sig = await arcade_user._signTypedData(
      domainData,
      dataType,
      message
    );

    let cd1 = nightmareImpDoor.interface.encodeFunctionData("mintTricksAndBoxes", [
        [ // partnerContracts
            MAYC
        ],
        [ // partnerTokenIds
            19145
        ],
        [ // isBox
            true
        ],
        [ // trickTokenIds
            0
        ],
        sig // signature
    ]);

    await usersAV.connect(arcade_user).call(nightmareImpDoor.address, cd1);
    
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}