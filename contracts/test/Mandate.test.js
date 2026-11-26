const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DECIMALS = 6;
const unit = (v) => ethers.parseUnits(String(v), DECIMALS);

describe("Agent spending mandates", function () {
  let token, gateway, tokenAddress;
  let owner, merchant, payer, agent, otherMerchant, stranger;

  async function invoice(amount, from = merchant) {
    const expiresAt = (await time.latest()) + 3600;
    const tx = await gateway.connect(from).createInvoice(
      tokenAddress, unit(amount), expiresAt, `AGENT-${Math.random()}`, ethers.randomBytes(32)
    );
    const receipt = await tx.wait();
    const log = receipt.logs.map((l) => gateway.interface.parseLog(l)).find((l) => l?.name === "InvoiceCreated");
    return log.args.invoiceId;
  }

  async function grant({ merchantLock = ethers.ZeroAddress, perInvoice = 50, cap = 100, ttl = 86400 } = {}) {
    const validUntil = (await time.latest()) + ttl;
    return gateway.connect(payer).grantMandate(
      agent.address, tokenAddress, merchantLock, unit(perInvoice), unit(cap), validUntil
    );
  }

  beforeEach(async function () {
    [owner, merchant, payer, agent, otherMerchant, stranger] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("tUSD8Mock")).deploy();
    tokenAddress = await token.getAddress();
    gateway = await (await ethers.getContractFactory("AevumPaymentGateway")).deploy(owner.address);
    await gateway.whitelistToken(tokenAddress, "tUSD8", DECIMALS);
    await gateway.registerMerchant(merchant.address, "M-1");
    await gateway.registerMerchant(otherMerchant.address, "M-2");
    await token.mint(payer.address, unit(1000));
    await token.connect(payer).approve(await gateway.getAddress(), unit(1000));
  });

  it("lets an agent pay from the payer's balance within the mandate", async function () {
    await expect(grant()).to.emit(gateway, "MandateGranted");
    const id = await invoice(40);
    const merchantBefore = await token.balanceOf(merchant.address);

    await expect(gateway.connect(agent).payWithMandate(id, payer.address))
      .to.emit(gateway, "MandatePayment")
      .withArgs(payer.address, agent.address, id, unit(40), unit(60));

    const inv = await gateway.getInvoice(id);
    expect(inv.payer).to.equal(payer.address);
    expect(inv.status).to.equal(1n);
    expect(await token.balanceOf(agent.address)).to.equal(0n);
    expect(await token.balanceOf(payer.address)).to.equal(unit(960));
    expect(await token.balanceOf(merchant.address)).to.equal(merchantBefore + unit(40) - inv.feePaid);
    expect(await gateway.mandateRemaining(payer.address, agent.address)).to.equal(unit(60));
  });

  it("enforces the per-invoice limit", async function () {
    await grant({ perInvoice: 30 });
    const id = await invoice(31);
    await expect(gateway.connect(agent).payWithMandate(id, payer.address))
      .to.be.revertedWithCustomError(gateway, "MandatePerInvoiceLimit");
  });

  it("enforces the total cap across invoices", async function () {
    await grant({ perInvoice: 50, cap: 80 });
    await gateway.connect(agent).payWithMandate(await invoice(50), payer.address);
    await expect(gateway.connect(agent).payWithMandate(await invoice(31), payer.address))
      .to.be.revertedWithCustomError(gateway, "MandateCapExceeded");
    await gateway.connect(agent).payWithMandate(await invoice(30), payer.address);
    expect(await gateway.mandateRemaining(payer.address, agent.address)).to.equal(0n);
  });

  it("stops working immediately after revoke", async function () {
    await grant();
    await expect(gateway.connect(payer).revokeMandate(agent.address))
      .to.emit(gateway, "MandateRevoked").withArgs(payer.address, agent.address, 0n);
    await expect(gateway.connect(agent).payWithMandate(await invoice(10), payer.address))
      .to.be.revertedWithCustomError(gateway, "MandateInactive");
    expect(await gateway.mandateRemaining(payer.address, agent.address)).to.equal(0n);
    await expect(gateway.connect(payer).revokeMandate(agent.address))
      .to.be.revertedWithCustomError(gateway, "MandateInactive");
  });

  it("can be revoked while the gateway is paused", async function () {
    await grant();
    await gateway.setPaused(true);
    await expect(gateway.connect(payer).revokeMandate(agent.address)).to.emit(gateway, "MandateRevoked");
  });

  it("rejects payments after expiry", async function () {
    await grant({ ttl: 600 });
    const id = await invoice(10);
    await time.increase(601);
    await expect(gateway.connect(agent).payWithMandate(id, payer.address))
      .to.be.revertedWithCustomError(gateway, "MandateExpired");
    expect(await gateway.mandateRemaining(payer.address, agent.address)).to.equal(0n);
  });

  it("respects a merchant lock", async function () {
    await grant({ merchantLock: merchant.address });
    await expect(gateway.connect(agent).payWithMandate(await invoice(10, otherMerchant), payer.address))
      .to.be.revertedWithCustomError(gateway, "MandateMerchantMismatch");
    await gateway.connect(agent).payWithMandate(await invoice(10), payer.address);
  });

  it("does not let a different address spend under someone else's mandate", async function () {
    await grant();
    await expect(gateway.connect(stranger).payWithMandate(await invoice(10), payer.address))
      .to.be.revertedWithCustomError(gateway, "MandateInactive");
  });

  it("does not consume the cap when the payment reverts", async function () {
    await grant();
    const id = await invoice(10);
    await gateway.connect(agent).payWithMandate(id, payer.address);
    await expect(gateway.connect(agent).payWithMandate(id, payer.address))
      .to.be.revertedWithCustomError(gateway, "InvoiceNotPending");
    expect(await gateway.mandateRemaining(payer.address, agent.address)).to.equal(unit(90));
  });

  it("validates mandate parameters", async function () {
    const until = (await time.latest()) + 3600;
    await expect(gateway.connect(payer).grantMandate(payer.address, tokenAddress, ethers.ZeroAddress, 1, 1, until))
      .to.be.revertedWithCustomError(gateway, "InvalidMandate");
    await expect(gateway.connect(payer).grantMandate(agent.address, tokenAddress, ethers.ZeroAddress, 2, 1, until))
      .to.be.revertedWithCustomError(gateway, "InvalidMandate");
    await expect(gateway.connect(payer).grantMandate(agent.address, stranger.address, ethers.ZeroAddress, 1, 1, until))
      .to.be.revertedWithCustomError(gateway, "TokenNotWhitelisted");
    await expect(gateway.connect(payer).grantMandate(agent.address, tokenAddress, ethers.ZeroAddress, 1, 1, 1))
      .to.be.revertedWithCustomError(gateway, "InvalidExpiry");
  });

  it("refunds a mandate payment to the payer, not the agent", async function () {
    await grant();
    const id = await invoice(20);
    await gateway.connect(agent).payWithMandate(id, payer.address);
    const inv = await gateway.getInvoice(id);
    await token.connect(merchant).approve(await gateway.getAddress(), inv.amount - inv.feePaid);
    await expect(gateway.connect(merchant).refund(id, agent.address))
      .to.be.revertedWithCustomError(gateway, "WrongRefundRecipient");
    await gateway.connect(merchant).refund(id, payer.address);
    expect(await token.balanceOf(payer.address)).to.equal(unit(1000));
  });

  it("emits ownership and fee collector events", async function () {
    await expect(gateway.setFeeCollector(stranger.address))
      .to.emit(gateway, "FeeCollectorUpdated").withArgs(owner.address, stranger.address);
    await expect(gateway.transferOwnership(merchant.address))
      .to.emit(gateway, "OwnershipTransferred").withArgs(owner.address, merchant.address);
    expect(await gateway.owner()).to.equal(merchant.address);
  });
});
