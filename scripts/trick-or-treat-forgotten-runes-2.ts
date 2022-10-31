/* eslint no-unused-vars: 0 */

import hre, { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { createLoanTermsSignature } from "../test/utils/eip712";
import { createVault } from "./utils/vault";
import {
    AssetVault,
    VaultFactory,
    CallWhitelist,
    NightmareImpDoor,
    MockERC20,
    OriginationController
} from "../typechain";
import type { LoanTerms } from "../test/utils/types";

/**
 * This script runs 1). mintTricksAndBoxes 2). unlockBoxes 3). mintTreats
 * on the NightmareImp Treasure box contract 0x59775fD5F266C216D7566eB216153aB8863C9c84.
 * 
 * To run this script: 
 * FORK_MAINNET=true npx hardhat run scripts/trick-or-treat-forgotten-runes-2.ts --network hardhat
 */

export async function main(): Promise<void> {

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////                 GLOBALS                ////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";
    const MAYC = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6";
    const BAKC = "0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623";
    const WHALE = "0x54BE3a794282C030b15E43aE2bB182E14c409C5e"; // dingaling.eth
    const NIGHTMARE_IMP_DOOR = "0xD52c79d897a24c275729112C3C5ea813b5703f88";

    const CALL_WHITELIST = "0xB4496F9798cEbd003c5d5a956B5B8f3933178C82";
    const ORIGINATION_CONTROLLER = "0x4c52ca29388A8A854095Fd2BeB83191D68DC840b";
    const BORROWER_NOTE = "0x337104A4f06260Ff327d6734C555A0f5d8F863aa";
    const VAULT_FACTORY = "0x6e9B4c2f6Bd57b7b924d29b5dcfCa1273Ecc94A2";
    const ARCADE_MSIG = "0x398e92C827C5FA0F33F171DC8E20570c5CfF330e";

    const factory721 = await ethers.getContractFactory("ERC721");
    const bayc = await factory721.attach(BAYC) as MockERC20;

    const callWhitelistFactory = await ethers.getContractFactory("CallWhitelist");
    const callWhitelist = await callWhitelistFactory.attach(CALL_WHITELIST) as CallWhitelist;

    const nightmareImpDoorFact = await ethers.getContractFactory("NightmareImpDoor");
    const nightmareImpDoor = await nightmareImpDoorFact.attach(NIGHTMARE_IMP_DOOR) as NightmareImpDoor;

    const ocFactory = await ethers.getContractFactory("OriginationController");
    const originationController = await ocFactory.attach(ORIGINATION_CONTROLLER) as OriginationController;

    const vfFactory = await ethers.getContractFactory("VaultFactory");
    const vaultFactory = await vfFactory.attach(VAULT_FACTORY) as VaultFactory;

    const tokenFactory = await ethers.getContractFactory("MockERC20");
    const token = await tokenFactory.deploy("WETH", "WETH") as MockERC20; // payable currency

    const [user1, lender, user3, user4, user5] = await ethers.getSigners();

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////      STEP 1: TOKEN DISTRIBUTION        ////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [WHALE],
    });
    const whale = await hre.ethers.getSigner(WHALE);

    // send ETH to users for gas
    await whale.sendTransaction({ to: ARCADE_MSIG, value: ethers.utils.parseEther("0.5") });
    // send BAYC to user 1
    await bayc.connect(whale).transferFrom(whale.address, user1.address, 1044);
    // mint principal to lender
    await token.mint(lender.address, ethers.utils.parseEther("10"));

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////          STEP 1: CALLWHITELIST         /////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Whitelisting trick or treat functions...");

    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [ARCADE_MSIG],
    });

    const msig = await hre.ethers.getSigner(ARCADE_MSIG);
    
    // Whitelist NightmareImpDoor - mintTricksAndBoxes
    let res = await callWhitelist.isWhitelisted(NIGHTMARE_IMP_DOOR, "0x1a491b52");
    if (res === false) {
        await callWhitelist.connect(msig).add(nightmareImpDoor.address, "0x1a491b52");
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ////////////////////////////////          STEP 5: LOAN ORIGINATION          //////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Starting loan...");

    const makeTerms = (vault: AssetVault): LoanTerms => ({
        durationSecs: 86_400,
        principal: ethers.utils.parseEther("10"),
        interestRate: ethers.utils.parseEther("10"),
        collateralAddress: vaultFactory.address,
        collateralId: vault.address,
        payableCurrency: token.address,
        numInstallments: 0,
        deadline: Math.floor(Date.now() / 1000 + 1000)
    });
    const makeSig = async (signer: SignerWithAddress, terms: LoanTerms) =>
        createLoanTermsSignature(
            ORIGINATION_CONTROLLER,
            "OriginationController",
            terms,
            signer,
            "2",
            2,
            "b"
        );
    
    // create vault for user 1
    const user1AV = await createVault(vaultFactory, user1);
    // transfer asset into vault
    await bayc.connect(user1).transferFrom(user1.address, user1AV.address, 1044);
    // approve to origination controller
    await vaultFactory.connect(user1).approve(ORIGINATION_CONTROLLER, user1AV.address);
    // user 1 signs terms
    const terms1 = makeTerms(user1AV);
    const sig1 = await makeSig(user1, terms1);
    // lender initializes loan
    await token.connect(lender).approve(ORIGINATION_CONTROLLER, ethers.utils.parseEther("10"));
    await originationController
        .connect(lender)
        .initializeLoan(terms1, user1.address, lender.address, sig1, 2);

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////          STEP 2: CALLS          ///////////////////////////////////////////s
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    console.log("Signing tx...");

    const domain = {
        name: 'NightmareImpDoor',
        version: '1',
        chainId: 1337,
        verifyingContract: nightmareImpDoor.address
    };

    const types = {
        TricksAndBoxes: [
            { name: 'to', type: 'address' },
            { name: "partnerContracts", type: "address[]" },
            { name: "partnerTokenIds", type: "uint256[]" },
            { name: "isBox", type: "bool[]" },
            { name: "trickTokenIds", type: "uint256[]" }
        ]
    };

    const value = {
        to: user1.address,
        partnerContracts: [BAYC],
        partnerTokenIds: [1044],
        isBox: [true],
        trickTokenIds: [0],
    };

    const sig = await user1._signTypedData(
      domain,
      types,
      value
    );
    console.log(sig)

    // call function
    console.log("Performing trick or treat operation...");
    let cd1 = nightmareImpDoor.interface.encodeFunctionData("mintTricksAndBoxes", [
        [ // partnerContracts
            BAYC
        ],
        [ // partnerTokenIds
            1044
        ],
        [ // isBox
            true
        ],
        [ // trickTokenIds
            0
        ],
        sig // signature
    ]);

    await user1AV.connect(user1).call(nightmareImpDoor.address, cd1);
    
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}