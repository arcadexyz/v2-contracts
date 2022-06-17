import { ethers } from "hardhat";
import { Contract } from "ethers";
import { MockERC20 } from "../../typechain";
import { config } from "./../../hardhat.config";

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
    const wethTx = await weth.mint(target, ethers.utils.parseEther(wethAmount.toString()));
    await wethTx.wait();
    const pawnTokenTx = await pawnToken.mint(target, ethers.utils.parseEther(pawnAmount.toString()));
    await pawnTokenTx.wait();
    const usdTx = await usd.mint(target, ethers.utils.parseUnits(usdAmount.toString(), 6));
    await usdTx.wait();
}
