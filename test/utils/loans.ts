import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber, ethers } from "ethers";

import { VaultFactory } from "../../typechain";
import { SignatureItem, ItemsPredicate } from "./types";

export const initializeBundle = async (vaultFactory: VaultFactory, user: SignerWithAddress): Promise<BigNumber> => {

    const tx = await vaultFactory.connect(user).initializeBundle(await user.getAddress());
    const receipt = await tx.wait();

    if (receipt && receipt.events) {
        for (const event of receipt.events) {
            if (event.event && event.event === "VaultCreated" && event.args && event.args.vault) {
                return event.args.vault;
            }
        }
        throw new Error("Unable to initialize bundle");
    } else {
        throw new Error("Unable to initialize bundle");
    }
};

export const encodeSignatureItems = (items: SignatureItem[]): string => {
    const types = ["(uint256,address,int256,uint256)[]"];
    const values = items.map(item => [item.cType, item.asset, item.tokenId, item.amount]);

    return ethers.utils.defaultAbiCoder.encode(types, [values]);
};

export const encodePredicates = (predicates: ItemsPredicate[]): string => {
    const types = ["(bytes,address)[]"];
    const values = predicates.map(p => [p.data, p.verifier]);

    const coded = ethers.utils.defaultAbiCoder.encode(types, [values]);
    return ethers.utils.keccak256(coded);
};
