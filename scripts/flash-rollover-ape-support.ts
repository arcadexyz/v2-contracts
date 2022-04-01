/* eslint no-unused-vars: 0 */

import fs from 'fs';
import hre, { ethers } from "hardhat";

import { SECTION_SEPARATOR } from "./bootstrap-tools";
import { ERC20, ERC1155, PromissoryNote, AssetWrapper, LoanCore } from "../typechain";

export async function main(): Promise<void> {
    // Also distribute USDC by impersonating a large account
    const BORROWER = "0xB6631E52E513eEE0b8c932d7c76F8ccfA607a28e";
    const LENDER = "0x6402cB41945A662E978c6a8A65d93c0Ab17F7AC9";
    const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const ASSET_WRAPPER = "0x1F563CDd688ad47b75E474FDe74E87C643d129b7";
    const WHALE = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";

    // const { flashRollover } = await deployWithApeSupport();

    // const f = await ethers.getContractFactory("FlashRollover")

    // const flashRollover = await f.attach("0xC06f3ec8601dC3e8116EDd05d5A1721DC2d7250E")

    // await hre.network.provider.request({
    //     method: "hardhat_impersonateAccount",
    //     params: [WHALE],
    // });

    // const whale = await hre.ethers.getSigner(WHALE);
    // await whale.sendTransaction({ to: BORROWER, value: ethers.utils.parseEther("1000") })
    // await whale.sendTransaction({ to: LENDER, value: ethers.utils.parseEther("1000") })

    // const tokenId = 10372;

    const erc1155Factory = await ethers.getContractFactory("ERC721");
    const ll = await erc1155Factory.attach("0xb7F7F6C52F2e2fdb1963Eab30438024864c313F6");
    const balance = await ll.ownerOf(9847);

    console.log('BALANCE', balance.toString());

    const bundleId = 13;

    const AssetWrapperFactory = await ethers.getContractFactory("AssetWrapper");
    const assetWrapper = <AssetWrapper>await AssetWrapperFactory.attach("0x5CB803c31e8f4F895a3AB19d8218646dC63e9Dc2");

    const result = await assetWrapper.numERC721Holdings(bundleId);
    console.log('NUM HOLDINGS', result.toString());

    const result2 = await assetWrapper['bundleERC721Holdings(uint256,uint256)'](bundleId, 0);
    console.log('NUM HOLDINGS', result2.tokenId.toString());
    console.log('NUM HOLDINGS', result2.tokenAddress.toString());

    const LoanCoreFactory = await ethers.getContractFactory("LoanCore");
    const loanCore = <LoanCore>await LoanCoreFactory.attach("0x7691EE8feBD406968D46F9De96cB8CC18fC8b325");

    const ld = await loanCore.getLoan(3);
    const tokenId = ld.terms.collateralTokenId;

    console.log("BUNDLE ID", tokenId.toString());

    const promissoryNoteFactory = await ethers.getContractFactory("PromissoryNote");
    const bn = await promissoryNoteFactory.attach("0xc3231258D6Ed397Dce7a52a27f816c8f41d22151")
    const ln = await promissoryNoteFactory.attach("0xe1eF2656D965ac9E3Fe151312f19F3D4C5f0EfA3")

    console.log(await bn.ownerOf(3));
    console.log(await ln.ownerOf(3));

    // console.log(ld)

    process.exit();

    // await hre.network.provider.request({
    //     method: "hardhat_impersonateAccount",
    //     params: [BORROWER],
    // });

    // const borrower = await hre.ethers.getSigner(BORROWER);

    // const payloadStr = fs.readFileSync('./rollover_payload.json', 'utf-8');
    // const payload = JSON.parse(payloadStr);

    // const erc20Factory = await ethers.getContractFactory("ERC20");
    // const usdc = <ERC20>await erc20Factory.attach(USDC_ADDRESS);

    // // Approve USDC
    // // await usdc.connect(borrower).approve(flashRollover.address, ethers.utils.parseUnits("100000", 6));

    // // Approve borrower note
    // // const bnFactory = await ethers.getContractFactory("PromissoryNote");
    // // const borrowerNote = <PromissoryNote>await bnFactory.attach(BORROWER_NOTE);

    // // await borrowerNote.connect(borrower).approve(flashRollover.address, 4);

    // console.log("Balance:", (await borrower.getBalance()).toString());

    // await flashRollover.connect(borrower).rolloverLoan(
    //     payload.contracts,
    //     payload.loanId,
    //     payload.newLoanTerms,
    //     payload.signature.v,
    //     Buffer.from(payload.signature.r, 'base64'),
    //     Buffer.from(payload.signature.s, 'base64')
    // );

    // // Roll over both loans
    // console.log(SECTION_SEPARATOR);
    // console.log("Rollover successful.\n");
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
