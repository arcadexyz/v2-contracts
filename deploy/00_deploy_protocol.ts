import { DeployFunction } from 'hardhat-deploy/types';
import { THardhatRuntimeEnvironmentExtended } from '../helpers/types/THardhatRuntimeEnvironmentExtended';
import { ethers, upgrades } from 'hardhat';
import { LoanCore, LoanCoreV2Mock, OriginationController } from "../typechain";

const ORIGINATOR_ROLE = "0x59abfac6520ec36a6556b2a4dd949cc40007459bcd5cd2507f1e5cc77b6bc97e";
const REPAYER_ROLE = "0x9c60024347074fd9de2c1e36003080d22dbc76a41ef87444d21e361bcb39118e";

const func: DeployFunction = async function (hre: THardhatRuntimeEnvironmentExtended) {
  const { getNamedAccounts, deployments } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();


  /// ===== FeeController =====
  const feeController = await deploy('FeeController', {
    from: deployer,
    log: true,
  });

  /// ===== BorrowerNote =====
  const borrowerNote = await deploy('BorrowerNote', {
    from: deployer,
    args: ["Arcade.xyz BorrowerNote", "aBN"],
    contract: "PromissoryNote",
    log: true,
  });
  /// ===== LenderNote =====
  const lenderNote = await deploy('LenderNote', {
    from: deployer,
    args: ["Arcade.xyz LenderNote", "aLN"],
    contract: "PromissoryNote",
    log: true,
  });

  /// ===== LoanCore =====
  const loanCore = await deploy('LoanCore_via_UUPS', {
    contract: 'LoanCore',
    from: deployer,
    args: [],
    log: true,
    proxy: {
      owner: deployer,
      proxyContract: 'ERC1967Proxy',
      proxyArgs: ['{implementation}', '{data}'],
      execute: {
        init: {
          methodName: "initialize",
          args: [deployer, feeController.address, borrowerNote.address, lenderNote.address],
        },
      },
    }
  });

  /// ===== OriginationController =====
  await deploy('OriginationController_via_UUPS', {
    contract: 'OriginationController',
    from: deployer,
    args: [],
    log: true,
    proxy: {
      owner: deployer,
      proxyContract: 'ERC1967Proxy',
      proxyArgs: ['{implementation}', '{data}'],
      execute: {
        init: {
          methodName: "initialize",
          args: [deployer, loanCore.address],
        },
      },
    }
  });

  /// ===== RepaymentController =====
  await deploy('RepaymentController', {
    from: deployer,
    args: [loanCore.address, borrowerNote.address, lenderNote.address],
    log: true,
  });


  /// ===== GrantRoles =====
//   const updateRepaymentControllerPermissions = await loanCore.grantRole(REPAYER_ROLE, repaymentController.address);
//   await updateRepaymentControllerPermissions.wait();
//
//   const updateOriginationControllerPermissions = await loanCore.grantRole(
//           ORIGINATOR_ROLE,
//           originationController.address,
//       );
//   await updateOriginationControllerPermissions.wait();
//

};

export default func;
func.tags = ['Protocol'];
