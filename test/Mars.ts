import hre, { ethers, upgrades } from "hardhat";
import assert from "assert";
import { expect } from "chai";

before("get factories", async function (){
  this.Mars = await hre.ethers.getContractFactory("Mars");
  this.MarsV2 = await hre.ethers.getContractFactory("MarsV2");
});


  it('goes to Mars', async function () {
    const mars = await upgrades.deployProxy(this.Mars, { kind: 'uups' });

    assert(await mars.name() === "Mars");
    console.log('---------------------------------------------------');
    console.log('this is updateValue', (await mars.updateValue()).toNumber());
    console.log('---------------------------------------------------');
   expect (await mars.updateValue()).to.equal(20);

    const marsv2 = await hre.upgrades.upgradeProxy(mars, this.MarsV2);
    assert(await marsv2.version() === "V2!");

  });

  it('upgrades to v2', async function () {
    const marsv2 = await hre.upgrades.upgradeProxy("0x42dE174663dc5F339AEe2d58744A622F88DA8c09", this.MarsV2);
    assert(await marsv2.version() === "V2!");
 console.log('---------------------------------------------------');
 console.log('this is the marsv2 updateValue', (await marsv2.updateValue()).toNumber());console.log('---------------------------------------------------');
   expect (await marsv2.updateValue()).to.equal(24);

  });



