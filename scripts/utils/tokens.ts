import { ethers } from "hardhat";
import { Contract } from "ethers";

import { MockERC20 } from "../../typechain";

export async function getBalance(asset: Contract, addr: string): Promise<string> {
    return (await asset.balanceOf(addr)).toString();
}

export async function mintTokens(
    target: any,
    [wethAmount, pawnAmount, usdAmount]: [number, number, number],
    weth: MockERC20,
    pawnToken: MockERC20,
    usd: MockERC20,
): Promise<void> {
    await weth.mint(target, ethers.utils.parseEther(wethAmount.toString()));
    await pawnToken.mint(target, ethers.utils.parseEther(pawnAmount.toString()));
    await usd.mint(target, ethers.utils.parseUnits(usdAmount.toString(), 6));
}