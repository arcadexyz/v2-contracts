import { expect } from "chai";
import hre, { ethers, waffle, upgrades } from "hardhat";
const { loadFixture } = waffle;
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { BigNumber, BigNumberish } from "ethers";

import {
    AssetVault,
    CallWhitelist,
    VaultFactory,
    MockCallDelegator,
    MockERC20,
    MockERC721,
    MockERC1155,
    CryptoPunksMarket,
    VaultInventoryReporter,
    VaultDepositRouter
} from "../typechain";
import { mint, ZERO_ADDRESS } from "./utils/erc20";
import { mint as mintERC721 } from "./utils/erc721";
import { mint as mintERC1155 } from "./utils/erc1155";
import { deploy } from "./utils/contracts";

type Signer = SignerWithAddress;

interface TestContext {
    vault: AssetVault;
    vaultTemplate: AssetVault;
    nft: VaultFactory;
    whitelist: CallWhitelist;
    bundleId: BigNumberish;
    mockERC20: MockERC20;
    mockERC721: MockERC721;
    mockERC1155: MockERC1155;
    punks: CryptoPunksMarket;
    reporter: VaultInventoryReporter;
    router: VaultDepositRouter;
    user: Signer;
    other: Signer;
    signers: Signer[];
}

describe("VaultDepositRouter", () => {
    /**
     * Creates a vault instance using the vault factory
     */
    const createVault = async (factory: VaultFactory, user: Signer): Promise<AssetVault> => {
        const tx = await factory.connect(user).initializeBundle(await user.getAddress());
        const receipt = await tx.wait();

        let vault: AssetVault | undefined;
        if (receipt && receipt.events) {
            for (const event of receipt.events) {
                if (event.args && event.args.vault) {
                    vault = <AssetVault>await hre.ethers.getContractAt("AssetVault", event.args.vault);
                }
            }
        } else {
            throw new Error("Unable to create new vault");
        }
        if (!vault) {
            throw new Error("Unable to create new vault");
        }
        return vault;
    };

    /**
     * Sets up a test context, deploying new contracts and returning them for use in a test
     */
    const fixture = async (): Promise<TestContext> => {
        const signers: Signer[] = await hre.ethers.getSigners();
        const whitelist = <CallWhitelist>await deploy("CallWhitelist", signers[0], []);
        const mockERC20 = <MockERC20>await deploy("MockERC20", signers[0], ["Mock ERC20", "MOCK"]);
        const mockERC721 = <MockERC721>await deploy("MockERC721", signers[0], ["Mock ERC721", "MOCK"]);
        const mockERC1155 = <MockERC1155>await deploy("MockERC1155", signers[0], []);

        const vaultTemplate = <AssetVault>await deploy("AssetVault", signers[0], []);
        const VaultFactoryFactory = await hre.ethers.getContractFactory("VaultFactory");
        const factory = <VaultFactory>await upgrades.deployProxy(
            VaultFactoryFactory,
            [vaultTemplate.address, whitelist.address],
            {
                kind: "uups",
            },
        );
        const vault = await createVault(factory, signers[0]);

        const punks = <CryptoPunksMarket>await deploy("CryptoPunksMarket", signers[0], []);

        const reporter = <VaultInventoryReporter>await deploy("VaultInventoryReporter", signers[0], []);
        const router = <VaultDepositRouter>await deploy("VaultDepositRouter", signers[0], [factory.address, reporter.address]);

        return {
            nft: factory,
            vault,
            vaultTemplate,
            whitelist,
            bundleId: vault.address,
            mockERC20,
            mockERC721,
            mockERC1155,
            user: signers[0],
            other: signers[1],
            signers: signers.slice(2),
            punks,
            reporter,
            router
        };
    };

    describe("Deployment", () => {
        it("should fail to deploy if deployed without a factory", async () => {
            const { reporter } = await loadFixture(fixture);

            const factory = await hre.ethers.getContractFactory("VaultDepositRouter");

            await expect(factory.deploy(ZERO_ADDRESS, reporter.address)).to.be.revertedWith("VDR_ZeroAddress");
        });

        it("should fail to deploy if deployed without a reporter", async () => {
            const { nft } = await loadFixture(fixture);

            const factory = await hre.ethers.getContractFactory("VaultDepositRouter");

            await expect(factory.deploy(nft.address, ZERO_ADDRESS)).to.be.revertedWith("VDR_ZeroAddress");
        });
    });

    describe.only("Deposits", () => {
        it("should not accept a deposit for a vault that does not exist");
        it("should not accept a deposit if the user is not the owner of a vault");
        it("should accept a deposit if the depositor has an approval from the owner");

        it("should accept deposit from an ERC20 token and report inventory", async () => {
            const { vault, mockERC20, user, router, reporter } = await loadFixture(fixture);
            const amount = hre.ethers.utils.parseUnits("50", 18);

            await mint(mockERC20, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC20.connect(user).approve(router.address, amount);
            await router.connect(user).depositERC20(vault.address, mockERC20.address, amount);

            expect(await mockERC20.balanceOf(vault.address)).to.equal(amount);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(1);
            expect(items[0].tokenAddress).to.eq(mockERC20.address);
            expect(items[0].tokenAmount).to.eq(amount);
        });

        it("should accept deposit from an ERC721 token and report inventory", async () => {
            const { vault, mockERC721, user, router, reporter } = await loadFixture(fixture);

            const tokenId = await mintERC721(mockERC721, user);
            console.log("ID 1", mockERC721.address, user.address, tokenId.toString(), router.address);

            // approve router to send ERC721 tokens in
            await mockERC721.connect(user).approve(router.address, tokenId);
            console.log("Approved");
            console.log("HERE:", await mockERC721.getApproved(tokenId));
            await router.connect(user).depositERC721(vault.address, mockERC721.address, tokenId);
            console.log("Done");

            expect(await mockERC721.balanceOf(vault.address)).to.equal(1);
            expect(await mockERC721.ownerOf(tokenId)).to.equal(vault.address);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(1);
            expect(items[0].tokenAddress).to.eq(mockERC721.address);
            expect(items[0].tokenId).to.eq(tokenId);
        });

        it("should accept deposit from an ERC1155 token and report inventory", async () => {
            const { vault, mockERC1155, user, router, reporter } = await loadFixture(fixture);
            const amount = hre.ethers.utils.parseUnits("50", 18);

            const tokenId = await mintERC1155(mockERC1155, user, amount);
            // approve router to send ERC20 tokens in
            await mockERC1155.connect(user).setApprovalForAll(router.address, true);
            await router.connect(user).depositERC1155(vault.address, mockERC1155.address, tokenId, amount);

            expect(await mockERC1155.balanceOf(vault.address, tokenId)).to.equal(amount);

            // Expect reporter to show correct inventory
            expect(await reporter.verify(vault.address)).to.eq(true);

            const items = await reporter.enumerate(vault.address);

            expect(items.length).to.eq(1);
            expect(items[0].tokenAddress).to.eq(mockERC1155.address);
            expect(items[0].tokenId).to.eq(tokenId);
            expect(items[0].tokenAmount).to.eq(amount);
        });
    });

    describe("enableWithdraw", () => {
        it("should close the vault", async () => {
            const { vault, user } = await loadFixture(fixture);
            expect(await vault.withdrawEnabled()).to.equal(false);
            await expect(vault.enableWithdraw())
                .to.emit(vault, "WithdrawEnabled")
                .withArgs(await user.getAddress());

            expect(await vault.withdrawEnabled()).to.equal(true);
        });

        it("should fail to close the vault by non-owner", async () => {
            const { vault, other } = await loadFixture(fixture);
            expect(await vault.withdrawEnabled()).to.equal(false);
            await expect(vault.connect(other).enableWithdraw()).to.be.revertedWith("OERC721_CallerNotOwner");

            expect(await vault.withdrawEnabled()).to.equal(false);
        });
    });

    describe("call", async () => {
        it("succeeds if current owner and on whitelist", async () => {
            const { whitelist, vault, mockERC20, user } = await loadFixture(fixture);

            const selector = mockERC20.interface.getSighash("mint");
            const mintData = await mockERC20.populateTransaction.mint(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            await whitelist.add(mockERC20.address, selector);

            const startingBalance = await mockERC20.balanceOf(await user.getAddress());
            await expect(vault.connect(user).call(mockERC20.address, mintData.data))
                .to.emit(vault, "Call")
                .withArgs(await user.getAddress(), mockERC20.address, mintData.data);
            const endingBalance = await mockERC20.balanceOf(await user.getAddress());
            expect(endingBalance.sub(startingBalance)).to.equal(ethers.utils.parseEther("1"));
        });

        it("succeeds if delegated and on whitelist", async () => {
            const { nft, whitelist, vault, mockERC20, user, other } = await loadFixture(fixture);

            const mockCallDelegator = <MockCallDelegator>await deploy("MockCallDelegator", other, []);
            await mockCallDelegator.connect(other).setCanCall(true);

            const selector = mockERC20.interface.getSighash("mint");
            const mintData = await mockERC20.populateTransaction.mint(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            // transfer the NFT to the call delegator (like using it as loan collateral)
            await nft.transferFrom(await user.getAddress(), mockCallDelegator.address, vault.address);
            await whitelist.add(mockERC20.address, selector);

            const startingBalance = await mockERC20.balanceOf(await user.getAddress());
            await expect(vault.connect(user).call(mockERC20.address, mintData.data))
                .to.emit(vault, "Call")
                .withArgs(await user.getAddress(), mockERC20.address, mintData.data);
            const endingBalance = await mockERC20.balanceOf(await user.getAddress());
            expect(endingBalance.sub(startingBalance)).to.equal(ethers.utils.parseEther("1"));
        });

        it("fails if withdraw enabled on vault", async () => {
            const { whitelist, vault, mockERC20, user, other } = await loadFixture(fixture);

            const mockCallDelegator = <MockCallDelegator>await deploy("MockCallDelegator", other, []);
            await mockCallDelegator.connect(other).setCanCall(true);

            const selector = mockERC20.interface.getSighash("mint");
            const mintData = await mockERC20.populateTransaction.mint(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            await whitelist.add(mockERC20.address, selector);

            // enable withdraw on the vault
            await vault.connect(user).enableWithdraw();

            await expect(vault.connect(user).call(mockERC20.address, mintData.data)).to.be.revertedWith(
                "AV_WithdrawsEnabled",
            );
        });

        it("fails if delegator disallows", async () => {
            const { nft, whitelist, vault, mockERC20, user, other } = await loadFixture(fixture);

            const mockCallDelegator = <MockCallDelegator>await deploy("MockCallDelegator", other, []);
            await mockCallDelegator.connect(other).setCanCall(false);

            const selector = mockERC20.interface.getSighash("mint");
            const mintData = await mockERC20.populateTransaction.mint(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            // transfer the NFT to the call delegator (like using it as loan collateral)
            await nft.transferFrom(await user.getAddress(), mockCallDelegator.address, vault.address);
            await whitelist.add(mockERC20.address, selector);

            await expect(vault.connect(user).call(mockERC20.address, mintData.data)).to.be.revertedWith(
                "AV_CallDisallowed",
            );
        });

        it("fails if delegator is EOA", async () => {
            const { nft, whitelist, vault, mockERC20, user, other } = await loadFixture(fixture);

            const mockCallDelegator = <MockCallDelegator>await deploy("MockCallDelegator", other, []);
            await mockCallDelegator.connect(other).setCanCall(true);

            const selector = mockERC20.interface.getSighash("mint(address,uint256)");

            const mintData = await mockERC20.populateTransaction.mint(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            // transfer the vault NFT to the call delegator (like using it as loan collateral)
            await nft.transferFrom(await user.getAddress(), mockCallDelegator.address, vault.address);

            await whitelist.add(await user.getAddress(), selector);

            await expect(vault.connect(user).call(await user.getAddress(), mintData.data)).to.be.revertedWith(
                "Address: call to non-contract",
            );
        });

        it("fails if delegator is contract which doesn't support interface", async () => {
            const { nft, whitelist, vault, mockERC20, user } = await loadFixture(fixture);

            const selector = mockERC20.interface.getSighash("mint");
            const mintData = await mockERC20.populateTransaction.mint(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            // transfer the NFT to the call delegator (like using it as loan collateral)
            await nft.transferFrom(await user.getAddress(), mockERC20.address, vault.address);
            await whitelist.add(mockERC20.address, selector);

            await expect(vault.connect(user).call(mockERC20.address, mintData.data)).to.be.revertedWith(
                "Transaction reverted: function selector was not recognized and there's no fallback function",
            );
        });

        it("fails from current owner if not whitelisted", async () => {
            const { vault, mockERC20, user } = await loadFixture(fixture);

            const mintData = await mockERC20.populateTransaction.mint(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            await expect(vault.connect(user).call(mockERC20.address, mintData.data)).to.be.revertedWith(
                "AV_NonWhitelistedCall",
            );
        });

        it("fails if delegated and not whitelisted", async () => {
            const { nft, vault, mockERC20, user, other } = await loadFixture(fixture);

            const mockCallDelegator = <MockCallDelegator>await deploy("MockCallDelegator", other, []);
            await mockCallDelegator.connect(other).setCanCall(true);

            const mintData = await mockERC20.populateTransaction.mint(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            await nft.transferFrom(await user.getAddress(), mockCallDelegator.address, vault.address);

            await expect(vault.connect(user).call(mockERC20.address, mintData.data)).to.be.revertedWith(
                "AV_NonWhitelistedCall",
            );
        });

        it("fails if on global blacklist", async () => {
            const { vault, mockERC20, user } = await loadFixture(fixture);

            const transferData = await mockERC20.populateTransaction.transfer(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!transferData || !transferData.data) throw new Error("Populate transaction failed");

            await expect(vault.connect(user).call(mockERC20.address, transferData.data)).to.be.revertedWith(
                "AV_NonWhitelistedCall",
            );
        });

        it("fails if on global blacklist even after whitelisting", async () => {
            const { whitelist, vault, mockERC20, user } = await loadFixture(fixture);

            const selector = mockERC20.interface.getSighash("transfer");
            const transferData = await mockERC20.populateTransaction.transfer(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!transferData || !transferData.data) throw new Error("Populate transaction failed");

            await whitelist.add(mockERC20.address, selector);

            await expect(vault.connect(user).call(mockERC20.address, transferData.data)).to.be.revertedWith(
                "AV_NonWhitelistedCall",
            );
        });

        it("fails if address is on the whitelist but selector is not", async () => {
            const { whitelist, vault, mockERC721, user } = await loadFixture(fixture);

            const selector = mockERC721.interface.getSighash("burn");
            const mintData = await mockERC721.populateTransaction.mint(await user.getAddress());
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            await whitelist.add(mockERC721.address, selector);

            await expect(vault.connect(user).call(mockERC721.address, mintData.data)).to.be.revertedWith(
                "AV_NonWhitelistedCall",
            );
        });

        it("fails if selector is on the whitelist but address is not", async () => {
            const { whitelist, vault, mockERC20, mockERC1155, user } = await loadFixture(fixture);

            const selector = mockERC20.interface.getSighash("mint");
            const mintData = await mockERC1155.populateTransaction.mint(
                await user.getAddress(),
                ethers.utils.parseEther("1"),
            );
            if (!mintData || !mintData.data) throw new Error("Populate transaction failed");

            await whitelist.add(mockERC20.address, selector);

            await expect(vault.connect(user).call(mockERC1155.address, mintData.data)).to.be.revertedWith(
                "AV_NonWhitelistedCall",
            );
        });
    });

    describe("Withdraw", () => {
        describe("ERC20", () => {
            /**
             * Set up a withdrawal test by depositing some ERC20s into a bundle
             */
            const deposit = async (token: MockERC20, vault: AssetVault, amount: BigNumber, user: Signer) => {
                await mint(token, user, amount);
                await token.connect(user).transfer(vault.address, amount);
            };

            it("should withdraw single deposit from a bundle", async () => {
                const { vault, mockERC20, user } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseUnits("50", 18);
                await deposit(mockERC20, vault, amount, user);

                await vault.connect(user).enableWithdraw();
                await expect(vault.connect(user).withdrawERC20(mockERC20.address, await user.getAddress()))
                    .to.emit(vault, "WithdrawERC20")
                    .withArgs(await user.getAddress(), mockERC20.address, await user.getAddress(), amount)
                    .to.emit(mockERC20, "Transfer")
                    .withArgs(vault.address, await user.getAddress(), amount);
            });

            it("should withdraw single deposit from a bundle after transfer", async () => {
                const { nft, bundleId, vault, mockERC20, user, other } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseUnits("50", 18);
                await deposit(mockERC20, vault, amount, user);
                await nft["safeTransferFrom(address,address,uint256)"](
                    await user.getAddress(),
                    await other.getAddress(),
                    bundleId,
                );

                await expect(vault.connect(other).enableWithdraw())
                    .to.emit(vault, "WithdrawEnabled")
                    .withArgs(await other.getAddress());
                await expect(vault.connect(other).withdrawERC20(mockERC20.address, await other.getAddress()))
                    .to.emit(vault, "WithdrawERC20")
                    .withArgs(await other.getAddress(), mockERC20.address, await other.getAddress(), amount)
                    .to.emit(mockERC20, "Transfer")
                    .withArgs(bundleId, await other.getAddress(), amount);
            });

            it("should withdraw multiple deposits of the same token from a bundle", async () => {
                const { vault, mockERC20, user } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseUnits("50", 18);
                await deposit(mockERC20, vault, amount, user);
                const secondAmount = hre.ethers.utils.parseUnits("14", 18);
                await deposit(mockERC20, vault, secondAmount, user);
                const total = amount.add(secondAmount);

                await vault.enableWithdraw();
                await expect(vault.connect(user).withdrawERC20(mockERC20.address, await user.getAddress()))
                    .to.emit(vault, "WithdrawERC20")
                    .withArgs(await user.getAddress(), mockERC20.address, await user.getAddress(), total)
                    .to.emit(mockERC20, "Transfer")
                    .withArgs(vault.address, await user.getAddress(), total);
            });

            it("should withdraw deposits of multiple tokens from a bundle", async () => {
                const { vault, user } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseUnits("50", 18);

                const tokens = [];
                for (let i = 0; i < 10; i++) {
                    const mockERC20 = <MockERC20>await deploy("MockERC20", user, ["Mock ERC20", "MOCK" + i]);
                    await deposit(mockERC20, vault, amount, user);
                    tokens.push(mockERC20);
                }

                await vault.enableWithdraw();
                for (const token of tokens) {
                    await expect(vault.connect(user).withdrawERC20(token.address, await user.getAddress()))
                        .to.emit(vault, "WithdrawERC20")
                        .withArgs(await user.getAddress(), token.address, await user.getAddress(), amount)
                        .to.emit(token, "Transfer")
                        .withArgs(vault.address, await user.getAddress(), amount);
                }
            });

            it("should fail to withdraw when withdraws disabled", async () => {
                const { vault, mockERC20, user } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseUnits("50", 18);
                await deposit(mockERC20, vault, amount, user);

                await expect(
                    vault.connect(user).withdrawERC20(mockERC20.address, await user.getAddress()),
                ).to.be.revertedWith("AV_WithdrawsDisabled");
            });

            it("should fail to withdraw from non-owner", async () => {
                const { vault, mockERC20, user, other } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseUnits("50", 18);
                await deposit(mockERC20, vault, amount, user);

                await vault.enableWithdraw();
                await expect(
                    vault.connect(other).withdrawERC20(mockERC20.address, await user.getAddress()),
                ).to.be.revertedWith("OERC721_CallerNotOwner");
            });

            it("should throw when withdraw called by non-owner", async () => {
                const { vault, mockERC20, user, other } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseUnits("50", 18);
                await deposit(mockERC20, vault, amount, user);

                await expect(
                    vault.connect(other).withdrawERC20(mockERC20.address, await user.getAddress()),
                ).to.be.revertedWith("OERC721_CallerNotOwner");
            });

            it("should fail when non-owner calls with approval", async () => {
                const { nft, vault, mockERC20, user, other } = await loadFixture(fixture);

                await nft.connect(user).approve(await other.getAddress(), vault.address);
                await expect(
                    vault.connect(other).withdrawERC20(mockERC20.address, await user.getAddress()),
                ).to.be.revertedWith("OERC721_CallerNotOwner");
            });
        });

        describe("ERC721", () => {
            /**
             * Set up a withdrawal test by depositing some ERC721s into a bundle
             */
            const deposit = async (token: MockERC721, vault: AssetVault, user: Signer) => {
                const tokenId = await mintERC721(token, user);
                await token["safeTransferFrom(address,address,uint256)"](
                    await user.getAddress(),
                    vault.address,
                    tokenId,
                );
                return tokenId;
            };

            it("should withdraw single deposit from a bundle", async () => {
                const { vault, mockERC721, user } = await loadFixture(fixture);
                const tokenId = await deposit(mockERC721, vault, user);

                await vault.enableWithdraw();
                await expect(vault.connect(user).withdrawERC721(mockERC721.address, tokenId, await user.getAddress()))
                    .to.emit(vault, "WithdrawERC721")
                    .withArgs(await user.getAddress(), mockERC721.address, await user.getAddress(), tokenId)
                    .to.emit(mockERC721, "Transfer")
                    .withArgs(vault.address, await user.getAddress(), tokenId);
            });

            it("should withdraw a CryptoPunk from a vault", async () => {
                const { vault, punks, user } = await loadFixture(fixture);
                const punkIndex = 1234;
                // claim ownership of punk
                await punks.setInitialOwner(await user.getAddress(), punkIndex);
                await punks.allInitialOwnersAssigned();
                // "approve" the punk to the vault
                await punks.offerPunkForSaleToAddress(punkIndex, 0, vault.address);
                // deposit the punk into the vault
                await punks.transferPunk(vault.address, punkIndex);

                await vault.enableWithdraw();
                await expect(vault.connect(user).withdrawPunk(punks.address, punkIndex, await user.getAddress()))
                    .to.emit(punks, "Transfer")
                    .withArgs(vault.address, await user.getAddress(), 1)
                    .to.emit(punks, "PunkTransfer")
                    .withArgs(vault.address, await user.getAddress(), punkIndex);
            });

            it("should throw when already withdrawn", async () => {
                const { vault, mockERC721, user } = await loadFixture(fixture);
                const tokenId = await deposit(mockERC721, vault, user);

                await vault.enableWithdraw();
                await expect(vault.connect(user).withdrawERC721(mockERC721.address, tokenId, await user.getAddress()))
                    .to.emit(vault, "WithdrawERC721")
                    .withArgs(await user.getAddress(), mockERC721.address, await user.getAddress(), tokenId)
                    .to.emit(mockERC721, "Transfer")
                    .withArgs(vault.address, await user.getAddress(), tokenId);

                await expect(
                    vault.connect(user).withdrawERC721(mockERC721.address, tokenId, await user.getAddress()),
                ).to.be.revertedWith("ERC721: transfer caller is not owner nor approved");
            });

            it("should throw when withdraw called by non-owner", async () => {
                const { vault, mockERC721, user, other } = await loadFixture(fixture);
                const tokenId = await deposit(mockERC721, vault, user);

                await vault.enableWithdraw();
                await expect(
                    vault.connect(other).withdrawERC721(mockERC721.address, tokenId, await user.getAddress()),
                ).to.be.revertedWith("OERC721_CallerNotOwner");
            });

            it("should fail to withdraw when withdraws disabled", async () => {
                const { vault, mockERC721, user } = await loadFixture(fixture);
                const tokenId = await deposit(mockERC721, vault, user);

                await expect(
                    vault.connect(user).withdrawERC721(mockERC721.address, tokenId, await user.getAddress()),
                ).to.be.revertedWith("AV_WithdrawsDisabled");
            });
        });

        describe("ERC1155", () => {
            /**
             * Set up a withdrawal test by depositing some ERC1155s into a bundle
             */
            const deposit = async (token: MockERC1155, vault: AssetVault, user: Signer, amount: BigNumber) => {
                const tokenId = await mintERC1155(token, user, amount);
                await token.safeTransferFrom(await user.getAddress(), vault.address, tokenId, amount, "0x");
                return tokenId;
            };

            it("should withdraw single deposit from a bundle", async () => {
                const { vault, mockERC1155, user } = await loadFixture(fixture);
                const amount = BigNumber.from("1");
                const tokenId = await deposit(mockERC1155, vault, user, amount);

                await vault.enableWithdraw();
                await expect(vault.connect(user).withdrawERC1155(mockERC1155.address, tokenId, await user.getAddress()))
                    .to.emit(vault, "WithdrawERC1155")
                    .withArgs(await user.getAddress(), mockERC1155.address, await user.getAddress(), tokenId, amount)
                    .to.emit(mockERC1155, "TransferSingle")
                    .withArgs(vault.address, vault.address, await user.getAddress(), tokenId, amount);
            });

            it("should withdraw fungible deposit from a bundle", async () => {
                const { vault, mockERC1155, user } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseEther("100");
                const tokenId = await deposit(mockERC1155, vault, user, amount);

                await vault.enableWithdraw();
                await expect(vault.connect(user).withdrawERC1155(mockERC1155.address, tokenId, await user.getAddress()))
                    .to.emit(vault, "WithdrawERC1155")
                    .withArgs(await user.getAddress(), mockERC1155.address, await user.getAddress(), tokenId, amount)
                    .to.emit(mockERC1155, "TransferSingle")
                    .withArgs(vault.address, vault.address, await user.getAddress(), tokenId, amount);
            });

            it("should fail to withdraw when withdraws disabled", async () => {
                const { vault, mockERC1155, user } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseEther("100");
                const tokenId = await deposit(mockERC1155, vault, user, amount);

                await expect(
                    vault.connect(user).withdrawERC1155(mockERC1155.address, tokenId, await user.getAddress()),
                ).to.be.revertedWith("AV_WithdrawsDisabled");
            });

            it("should throw when withdraw called by non-owner", async () => {
                const { vault, mockERC1155, user, other } = await loadFixture(fixture);
                const amount = BigNumber.from("1");
                const tokenId = await deposit(mockERC1155, vault, user, amount);

                await vault.enableWithdraw();
                await expect(
                    vault.connect(other).withdrawERC1155(mockERC1155.address, tokenId, await other.getAddress()),
                ).to.be.revertedWith("OERC721_CallerNotOwner");
            });
        });

        describe("ETH", () => {
            const deposit = async (vault: AssetVault, user: Signer, amount: BigNumber) => {
                await user.sendTransaction({
                    to: vault.address,
                    value: amount,
                });
            };

            it("should withdraw single deposit from a bundle", async () => {
                const { vault, user } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseEther("123");
                await deposit(vault, user, amount);
                const startingBalance = await vault.provider.getBalance(await user.getAddress());

                await vault.enableWithdraw();
                await expect(vault.connect(user).withdrawETH(await user.getAddress()))
                    .to.emit(vault, "WithdrawETH")
                    .withArgs(await user.getAddress(), await user.getAddress(), amount);

                const threshold = hre.ethers.utils.parseEther("0.01"); // for txn fee
                const endingBalance = await vault.provider.getBalance(await user.getAddress());
                expect(endingBalance.sub(startingBalance).gt(amount.sub(threshold))).to.be.true;
            });

            it("should fail to withdraw when withdraws disabled", async () => {
                const { vault, user } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseEther("123");
                await deposit(vault, user, amount);

                await expect(vault.connect(user).withdrawETH(await user.getAddress())).to.be.revertedWith(
                    "AV_WithdrawsDisabled",
                );
            });

            it("should throw when withdraw called by non-owner", async () => {
                const { vault, user, other } = await loadFixture(fixture);
                const amount = hre.ethers.utils.parseEther("9");
                await deposit(vault, user, amount);

                await expect(vault.connect(other).withdrawETH(await other.getAddress())).to.be.revertedWith(
                    "OERC721_CallerNotOwner",
                );
            });
        });

        describe("Introspection", function () {
            it("should return true for declaring support for eip165 interface contract", async () => {
                const { nft } = await loadFixture(fixture);
                // https://eips.ethereum.org/EIPS/eip-165#test-cases
                expect(await nft.supportsInterface("0x01ffc9a7")).to.be.true;
                expect(await nft.supportsInterface("0xfafafafa")).to.be.false;
            });
        });
    });
});
