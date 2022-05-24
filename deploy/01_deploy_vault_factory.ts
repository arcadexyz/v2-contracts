import { DeployFunction } from 'hardhat-deploy/types';
import { THardhatRuntimeEnvironmentExtended } from '../helpers/types/THardhatRuntimeEnvironmentExtended';
import { ethers, upgrades } from 'hardhat';
import { VaultFactory } from "../typechain";

const func: DeployFunction = async function (hre: THardhatRuntimeEnvironmentExtended) {
  const { getNamedAccounts, deployments } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  /// ===== VaultTemplate =====
  const vaultTemplate = await deploy('AssetVault', {
    from: deployer,
    log: true,
  });
  console.log("Using vaultTemplate deployed at: ", vaultTemplate.address)

  const whitelist = await ethers.getContract("CallWhitelist", deployer);

/// ===== VaultFactory =====
  const VaultFactoryFactory = await ethers.getContractFactory("VaultFactory");
  const vaultFactory = <VaultFactory>await upgrades.deployProxy(VaultFactoryFactory, [vaultTemplate.address, whitelist.address], { kind: "uups" });
  await vaultFactory.deployed();
  console.log("deployed vaultFactory to: ", vaultFactory.address)

  // verify template set through initializer
  //const res = await vaultFactory.template();
  //console.log(res)
};

export default func;
func.tags = ['VaultFactory'];
