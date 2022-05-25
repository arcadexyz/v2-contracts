import { DeployFunction } from 'hardhat-deploy/types';
import { THardhatRuntimeEnvironmentExtended } from '../helpers/types/THardhatRuntimeEnvironmentExtended';
import { ethers, upgrades } from 'hardhat';
import { LoanCore, OriginationController } from "../typechain";

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
  // deploy loan core via proxy pattern
  const LoanCoreFactory = await ethers.getContractFactory("LoanCore");
  const loanCore = <LoanCore>await upgrades.deployProxy(LoanCoreFactory, [feeController.address, borrowerNote.address, lenderNote.address], { kind: "uups" });
  await loanCore.deployed();
  console.log("deployed LoanCore to: ", loanCore.address)

  // verify initialized
  // const res = await loanCore.borrowerNote();
  // console.log(res)


  /// ===== OriginationController =====
  const OriginationControllerFactory = await ethers.getContractFactory("OriginationController");
  const originationController = <OriginationController>await upgrades.deployProxy(OriginationControllerFactory, [loanCore.address], { kind: "uups" });
  await originationController.deployed();
  console.log("deployed Origination Controller to: ", originationController.address)

  // verify initialized
  //const res = await originationController.loanCore();
  //console.log(res);

  /// ===== RepaymentController =====
  const repaymentController = await deploy('RepaymentController', {
    from: deployer,
    args: [loanCore.address, borrowerNote.address, lenderNote.address],
    log: true,
  });


  /// ===== GrantRoles =====
  const updateRepaymentControllerPermissions = await loanCore.grantRole(REPAYER_ROLE, repaymentController.address);
  await updateRepaymentControllerPermissions.wait();

  const updateOriginationControllerPermissions = await loanCore.grantRole(
          ORIGINATOR_ROLE,
          originationController.address,
      );
  await updateOriginationControllerPermissions.wait();

};

export default func;
func.tags = ['Protocol'];
