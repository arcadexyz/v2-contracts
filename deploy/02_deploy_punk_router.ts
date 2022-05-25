import { DeployFunction } from 'hardhat-deploy/types';
import { THardhatRuntimeEnvironmentExtended } from '../helpers/types/THardhatRuntimeEnvironmentExtended';

const WRAPPED_PUNKS = "0xb7F7F6C52F2e2fdb1963Eab30438024864c313F6";
const CRYPTO_PUNKS = "0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb";

const func: DeployFunction = async function (hre: THardhatRuntimeEnvironmentExtended) {
  const { getNamedAccounts, deployments } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  /// ===== PunkRouter =====
  await deploy('PunkRouter', {
    from: deployer,
    log: true,
    args: [WRAPPED_PUNKS, CRYPTO_PUNKS]
  });
};

export default func;
func.tags = ['PunkRouter'];
