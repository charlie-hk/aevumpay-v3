const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * AevumPay contract tests.
 *
 * NOTE on decimals: the OFFICIAL tUSD8 on the Aevum testnet uses 6 decimals.
 * These tests use a mock token (contracts/mocks/tUSD8Mock.sol) that mirrors
 * the official token's 6-decimal precision, so the gateway is exercised with
 * the real on-chain behaviour. The gateway itself is decimal-agnostic — it
 * stores whatever smallest-unit amount the merchant passes and whitelists each
 * token with its real decimals.
 *
 * Run: npx hardhat test
 */

const DECIMALS = 6;
const unit = (v) => ethers.parseUnits(String(v), DECIMALS);

describe("AevumPay Contracts (official 6-decimals tUSD8)", function () {
  let tUSD8;
  let gateway;
  let owner, merchant, customer, other;

  beforeEach(async function () {
    [owner, merchant, customer, other] = await ethers.getSigners();

    // Deploy a 6-decimals mock that mirrors the official tUSD8.
    const factory = await ethers.getContractFactory("tUSD8Mock");
    tUSD8 = await factory.deploy();
    await tUSD8.waitForDeployment();

    const Gateway = await ethers.getContractFactory("AevumPaymentGateway");
    gateway = await Gateway.deploy(owner.address);

    // Whitelist with the REAL decimals (6), exactly like deploy.js does.
    await gateway.whitelistToken(await tUSD8.getAddress(), "tUSD8", DECIMALS);
    await gateway.registerMerchant(merchant.address, "MERCHANT-001");

    // Fund customer + merchant.
    await tUSD8.mint(customer.address, unit(10000));
    await tUSD8.mint(merchant.address, unit(1000));
  });

  describe("tUSD8 (6 decimals)", function () {
    it("has correct metadata and 6 decimals", async function () {
      expect(await tUSD8.name()).to.equal("Test USD 8");
      expect(await tUSD8.symbol()).to.equal("tUSD8");
      expect(await tUSD8.decimals()).to.equal(6);
    });

    it("premints 1,000,000 to deployer", async function () {
      expect(await tUSD8.balanceOf(owner.address)).to.equal(unit(1000000));
    });

    it("transfers tokens", async function () {
      await tUSD8.connect(customer).transfer(other.address, unit(100));
      expect(await tUSD8.balanceOf(other.address)).to.equal(unit(100));
    });
  });

  describe("AevumPaymentGateway", function () {
    it("registers merchants", async function () {
      expect(await gateway.isMerchant(merchant.address)).to.be.true;
      expect(await gateway.isMerchant(other.address)).to.be.false;
    });

    it("rejects invoice creation from non-merchant", async function () {
      await expect(
        gateway.connect(other).createInvoice(
          await tUSD8.getAddress(), unit(50),
          (await ethers.provider.getBlock("latest")).timestamp + 3600,
          "ORDER-1", ethers.randomBytes(32)
        )
      ).to.be.revertedWithCustomError(gateway, "NotMerchant");
    });

    it("rejects non-whitelisted tokens", async function () {
      await expect(
        gateway.connect(merchant).createInvoice(
          other.address, unit(50),
          (await ethers.provider.getBlock("latest")).timestamp + 3600,
          "ORDER-1", ethers.randomBytes(32)
        )
      ).to.be.revertedWithCustomError(gateway, "TokenNotWhitelisted");
    });

    it("creates an invoice and emits InvoiceCreated", async function () {
      const tx = await gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), unit(50),
        (await ethers.provider.getBlock("latest")).timestamp + 3600,
        "ORDER-1", ethers.randomBytes(32)
      );
      const receipt = await tx.wait();
      const evt = receipt.logs
        .map((l) => { try { return gateway.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "InvoiceCreated");
      expect(evt).to.not.be.undefined;
      expect(evt.args.merchant).to.equal(merchant.address);
      expect(evt.args.amount).to.equal(unit(50));
    });

    it("processes the full payment flow with 0.25% fee", async function () {
      const createTx = await gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), unit(50),
        (await ethers.provider.getBlock("latest")).timestamp + 3600,
        "ORDER-1", ethers.randomBytes(32)
      );
      const receipt = await createTx.wait();
      const evt = receipt.logs
        .map((l) => { try { return gateway.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "InvoiceCreated");
      const invoiceId = evt.args.invoiceId;

      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(50));

      const before = await tUSD8.balanceOf(merchant.address);
      await gateway.connect(customer).pay(invoiceId);
      const after = await tUSD8.balanceOf(merchant.address);

      // 50 - 0.25% = 49.875
      expect(after - before).to.equal(unit(49.875));
      expect(await gateway.reservedFees(await tUSD8.getAddress())).to.equal(unit(0.125));

      const inv = await gateway.getInvoice(invoiceId);
      expect(inv.status).to.equal(1); // PAID
      expect(inv.payer).to.equal(customer.address);
    });

    it("rejects payment to an expired invoice", async function () {
      const block = await ethers.provider.getBlock("latest");
      const expirySec = 60;
      const createTx = await gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), unit(50),
        block.timestamp + expirySec, "ORDER-1", ethers.randomBytes(32)
      );
      const receipt = await createTx.wait();
      const evt = receipt.logs
        .map((l) => { try { return gateway.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "InvoiceCreated");
      const invoiceId = evt.args.invoiceId;

      await ethers.provider.send("evm_increaseTime", [expirySec + 1]);
      await ethers.provider.send("evm_mine", []);

      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(50));
      await expect(gateway.connect(customer).pay(invoiceId))
        .to.be.revertedWithCustomError(gateway, "InvoiceExpiredError");
    });

    it("allows a merchant to refund a paid invoice", async function () {
      const createTx = await gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), unit(50),
        (await ethers.provider.getBlock("latest")).timestamp + 3600,
        "ORDER-1", ethers.randomBytes(32)
      );
      const receipt = await createTx.wait();
      const evt = receipt.logs
        .map((l) => { try { return gateway.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "InvoiceCreated");
      const invoiceId = evt.args.invoiceId;

      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(50));
      await gateway.connect(customer).pay(invoiceId);

      // merchant must approve the gateway to pull the refund back
      await tUSD8.connect(merchant).approve(await gateway.getAddress(), unit(50));

      const before = await tUSD8.balanceOf(customer.address);
      await gateway.connect(merchant).refund(invoiceId, customer.address);
      const after = await tUSD8.balanceOf(customer.address);

      expect(after - before).to.equal(unit(50));
      const inv = await gateway.getInvoice(invoiceId);
      expect(inv.status).to.equal(3); // REFUNDED
    });

    it("lets the owner pause/unpause the gateway", async function () {
      await gateway.setPaused(true);
      expect(await gateway.paused()).to.be.true;
      await gateway.setPaused(false);
      expect(await gateway.paused()).to.be.false;
    });

    it("prevents fee being set above 5%", async function () {
      await expect(gateway.setFeeBps(501)).to.be.reverted; // > 500
      await gateway.setFeeBps(500); // exactly 5% — OK
      expect(await gateway.feeBps()).to.equal(500);
    });
  });

  describe("Refund accounting", function () {
    async function createAndPay(amount) {
      const createTx = await gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), amount,
        (await ethers.provider.getBlock("latest")).timestamp + 3600,
        "ORDER-R", ethers.randomBytes(32)
      );
      const receipt = await createTx.wait();
      const evt = receipt.logs
        .map((l) => { try { return gateway.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "InvoiceCreated");
      const invoiceId = evt.args.invoiceId;

      await tUSD8.connect(customer).approve(await gateway.getAddress(), amount);
      await gateway.connect(customer).pay(invoiceId);
      return invoiceId;
    }

    it("returns the full amount to the customer, fee included", async function () {
      const invoiceId = await createAndPay(unit(50));
      const token = await tUSD8.getAddress();

      const merchantBefore = await tUSD8.balanceOf(merchant.address);
      const customerBefore = await tUSD8.balanceOf(customer.address);

      // The merchant only ever received 49.875, so it only approves that much.
      await tUSD8.connect(merchant).approve(await gateway.getAddress(), unit(49.875));
      await gateway.connect(merchant).refund(invoiceId, customer.address);

      const merchantAfter = await tUSD8.balanceOf(merchant.address);
      const customerAfter = await tUSD8.balanceOf(customer.address);

      // Customer is made whole — the escrowed fee comes back too.
      expect(customerAfter - customerBefore).to.equal(unit(50));
      // Merchant gives back exactly what it received.
      expect(merchantBefore - merchantAfter).to.equal(unit(49.875));
      // Escrow is drained, nothing left stranded.
      expect(await gateway.pendingFees(token)).to.equal(0n);
      expect(await gateway.reservedFees(token)).to.equal(0n);
    });

    it("is unaffected by a fee change between payment and refund", async function () {
      const invoiceId = await createAndPay(unit(100));
      const token = await tUSD8.getAddress();

      // Owner bumps the fee to 5% after the invoice was paid at 0.25%.
      await gateway.setFeeBps(500);

      const customerBefore = await tUSD8.balanceOf(customer.address);
      await tUSD8.connect(merchant).approve(await gateway.getAddress(), unit(100));
      await gateway.connect(merchant).refund(invoiceId, customer.address);
      const customerAfter = await tUSD8.balanceOf(customer.address);

      // Refund uses the fee stored on the invoice, not the new rate.
      expect(customerAfter - customerBefore).to.equal(unit(100));
      expect(await gateway.pendingFees(token)).to.equal(0n);
      expect(await gateway.reservedFees(token)).to.equal(0n);
    });

    it("rejects a refund from someone who is not the merchant", async function () {
      const invoiceId = await createAndPay(unit(10));
      await expect(
        gateway.connect(other).refund(invoiceId, customer.address)
      ).to.be.revertedWithCustomError(gateway, "NotMerchant");
    });

    it("only refunds to the wallet that paid the invoice", async function () {
      const invoiceId = await createAndPay(unit(10));
      await tUSD8.connect(merchant).approve(await gateway.getAddress(), unit(10));
      await expect(
        gateway.connect(merchant).refund(invoiceId, merchant.address)
      ).to.be.revertedWithCustomError(gateway, "WrongRefundRecipient");
    });
  });

  describe("USDT-style token (transfer returns nothing)", function () {
    let usdt;
    let usdtGateway;

    beforeEach(async function () {
      const Usdt = await ethers.getContractFactory("USDTLikeMock");
      usdt = await Usdt.deploy();
      await usdt.waitForDeployment();

      const Gateway = await ethers.getContractFactory("AevumPaymentGateway");
      usdtGateway = await Gateway.deploy(owner.address);

      await usdtGateway.whitelistToken(await usdt.getAddress(), "USDTm", DECIMALS);
      await usdtGateway.registerMerchant(merchant.address, "MERCHANT-002");

      await usdt.mint(customer.address, unit(1000));
      await usdt.mint(merchant.address, unit(100));
    });

    it("pays an invoice even though transfer() has no return value", async function () {
      const createTx = await usdtGateway.connect(merchant).createInvoice(
        await usdt.getAddress(), unit(40),
        (await ethers.provider.getBlock("latest")).timestamp + 3600,
        "ORDER-U", ethers.randomBytes(32)
      );
      const receipt = await createTx.wait();
      const evt = receipt.logs
        .map((l) => { try { return usdtGateway.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "InvoiceCreated");
      const invoiceId = evt.args.invoiceId;

      await usdt.connect(customer).approve(await usdtGateway.getAddress(), unit(40));

      const before = await usdt.balanceOf(merchant.address);
      await usdtGateway.connect(customer).pay(invoiceId);
      const after = await usdt.balanceOf(merchant.address);

      // 40 - 0.25% = 39.9
      expect(after - before).to.equal(unit(39.9));
      expect(await usdtGateway.reservedFees(await usdt.getAddress())).to.equal(unit(0.1));
    });

    it("refunds an invoice paid with a non-returning token", async function () {
      const createTx = await usdtGateway.connect(merchant).createInvoice(
        await usdt.getAddress(), unit(40),
        (await ethers.provider.getBlock("latest")).timestamp + 3600,
        "ORDER-U2", ethers.randomBytes(32)
      );
      const receipt = await createTx.wait();
      const evt = receipt.logs
        .map((l) => { try { return usdtGateway.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "InvoiceCreated");
      const invoiceId = evt.args.invoiceId;

      await usdt.connect(customer).approve(await usdtGateway.getAddress(), unit(40));
      await usdtGateway.connect(customer).pay(invoiceId);

      const customerBefore = await usdt.balanceOf(customer.address);
      await usdt.connect(merchant).approve(await usdtGateway.getAddress(), unit(39.9));
      await usdtGateway.connect(merchant).refund(invoiceId, customer.address);
      const customerAfter = await usdt.balanceOf(customer.address);

      expect(customerAfter - customerBefore).to.equal(unit(40));
    });
  });

  /**
   * Lifecycle edge cases: cancel, expire, replay, duplicate ids.
   * These guard the state machine (PENDING -> PAID | EXPIRED | CANCELLED | REFUNDED)
   * which is the part a payment gateway is judged on.
   */
  describe("Lifecycle edge cases (cancel, expire, replay)", function () {
    async function createPending(amount, ttl, ref) {
      const block = await ethers.provider.getBlock("latest");
      const tx = await gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), unit(amount), block.timestamp + ttl, ref, ethers.randomBytes(32)
      );
      const receipt = await tx.wait();
      const evt = receipt.logs
        .map((l) => { try { return gateway.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "InvoiceCreated");
      return evt.args.invoiceId;
    }

    it("lets the merchant cancel a pending invoice", async function () {
      const id = await createPending(25, 3600, "ORDER-C1");
      await expect(gateway.connect(merchant).cancel(id))
        .to.emit(gateway, "InvoiceCancelled");
      const inv = await gateway.getInvoice(id);
      expect(inv.status).to.equal(4); // CANCELLED
    });

    it("rejects a cancel from a non-merchant", async function () {
      const id = await createPending(25, 3600, "ORDER-C2");
      await expect(gateway.connect(customer).cancel(id))
        .to.be.revertedWithCustomError(gateway, "NotMerchant");
    });

    it("rejects payment of a cancelled invoice", async function () {
      const id = await createPending(25, 3600, "ORDER-C3");
      await gateway.connect(merchant).cancel(id);
      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(25));
      await expect(gateway.connect(customer).pay(id))
        .to.be.revertedWithCustomError(gateway, "InvoiceNotPending");
    });

    it("rejects cancel after the invoice was paid", async function () {
      const id = await createPending(25, 3600, "ORDER-C4");
      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(25));
      await gateway.connect(customer).pay(id);
      await expect(gateway.connect(merchant).cancel(id))
        .to.be.revertedWithCustomError(gateway, "InvoiceNotPending");
    });

    it("marks an expired invoice via markExpired, and only after it expired", async function () {
      const id = await createPending(10, 60, "ORDER-E1");

      // Too early — anyone may call, but the invoice is still valid
      await expect(gateway.connect(other).markExpired(id))
        .to.be.revertedWithCustomError(gateway, "InvoiceExpiredError");

      await ethers.provider.send("evm_increaseTime", [61]);
      await ethers.provider.send("evm_mine", []);

      await expect(gateway.connect(other).markExpired(id))
        .to.emit(gateway, "InvoiceExpired");
      const inv = await gateway.getInvoice(id);
      expect(inv.status).to.equal(2); // EXPIRED
    });

    it("rejects a second payment for the same invoice", async function () {
      const id = await createPending(50, 3600, "ORDER-R1");
      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(100));
      await gateway.connect(customer).pay(id);
      await expect(gateway.connect(customer).pay(id))
        .to.be.revertedWithCustomError(gateway, "InvoiceNotPending");
    });

    it("rejects a second refund for the same invoice", async function () {
      const id = await createPending(50, 3600, "ORDER-R2");
      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(50));
      await gateway.connect(customer).pay(id);
      await tUSD8.connect(merchant).approve(await gateway.getAddress(), unit(100));
      await gateway.connect(merchant).refund(id, customer.address);
      await expect(gateway.connect(merchant).refund(id, customer.address))
        .to.be.revertedWithCustomError(gateway, "InvoiceNotPending");
    });

    it("rejects invoice creation with zero amount or a past expiry", async function () {
      const block = await ethers.provider.getBlock("latest");
      await expect(gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), 0, block.timestamp + 3600, "ORDER-Z", ethers.randomBytes(32)
      )).to.be.revertedWithCustomError(gateway, "AmountMismatch");

      await expect(gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), unit(1), block.timestamp - 1, "ORDER-P", ethers.randomBytes(32)
      )).to.be.revertedWithCustomError(gateway, "InvalidExpiry");
    });

    it("rejects a duplicate invoice id (same merchant, orderRef and salt)", async function () {
      const salt = ethers.randomBytes(32);
      const block = await ethers.provider.getBlock("latest");
      const exp = block.timestamp + 3600;
      await gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), unit(5), exp, "ORDER-DUP", salt
      );
      await expect(gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), unit(5), exp, "ORDER-DUP", salt
      )).to.be.revertedWithCustomError(gateway, "InvoiceAlreadyPaid");
    });

    it("rejects new payments in a delisted token without changing the pending invoice", async function () {
      const token = await tUSD8.getAddress();
      const id = await createPending(25, 3600, "ORDER-DELIST");
      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(25));
      await gateway.delistToken(token);
      await expect(gateway.connect(customer).pay(id))
        .to.be.revertedWithCustomError(gateway, "TokenNotWhitelisted");
      expect((await gateway.getInvoice(id)).status).to.equal(0);
      expect(await gateway.reservedFees(token)).to.equal(0);
    });

    it("rejects payment while the gateway is paused", async function () {
      const id = await createPending(25, 3600, "ORDER-PAUSE");
      await gateway.setPaused(true);
      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(25));
      await expect(gateway.connect(customer).pay(id))
        .to.be.revertedWithCustomError(gateway, "Paused");
      await gateway.setPaused(false);
    });
  });

  /**
   * V3 fee reserves: a paid invoice's fee is reserved until a refund or
   * permissionless crystallization. Only crystallized fees can be withdrawn.
   */
  describe("Fee escrow", function () {
    async function payAmount(amount, ref) {
      const block = await ethers.provider.getBlock("latest");
      const tx = await gateway.connect(merchant).createInvoice(
        await tUSD8.getAddress(), unit(amount), block.timestamp + 3600, ref, ethers.randomBytes(32)
      );
      const receipt = await tx.wait();
      const evt = receipt.logs
        .map((l) => { try { return gateway.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "InvoiceCreated");
      const id = evt.args.invoiceId;
      await tUSD8.connect(customer).approve(await gateway.getAddress(), unit(amount));
      await gateway.connect(customer).pay(id);
      return id;
    }

    it("moves expired fees once and withdraws only crystallized fees", async function () {
      const old = await payAmount(100, "ORDER-F1");
      await time.increase(60);
      const current = await payAmount(300, "ORDER-F2");
      const token = await tUSD8.getAddress();
      const deadline = await gateway.refundDeadline(old);
      const collectorBefore = await tUSD8.balanceOf(owner.address);

      expect(await gateway.reservedFees(token)).to.equal(unit(1));
      expect(await gateway.pendingFees(token)).to.equal(0);
      await expect(gateway.withdrawFees(token)).to.be.revertedWithCustomError(gateway, "AmountMismatch");

      await time.setNextBlockTimestamp(deadline + 1n);
      await expect(gateway.connect(other).crystallizeFee(old))
        .to.emit(gateway, "FeeCrystallized").withArgs(old, token, unit(0.25));
      expect(await gateway.feeCrystallized(old)).to.equal(true);
      expect(await gateway.isInvoicePaid(old)).to.equal(true);
      expect((await gateway.getInvoice(old)).feePaid).to.equal(unit(0.25));
      expect(await gateway.reservedFees(token)).to.equal(unit(0.75));
      expect(await gateway.pendingFees(token)).to.equal(unit(0.25));
      expect(await tUSD8.balanceOf(await gateway.getAddress())).to.equal(unit(1));
      await expect(gateway.connect(other).crystallizeFee(old))
        .to.be.revertedWithCustomError(gateway, "FeeAlreadyCrystallized");

      await expect(gateway.withdrawFees(token))
        .to.emit(gateway, "FeeWithdrawn").withArgs(owner.address, unit(0.25));
      expect((await tUSD8.balanceOf(owner.address)) - collectorBefore).to.equal(unit(0.25));
      expect(await gateway.pendingFees(token)).to.equal(0);
      expect(await gateway.reservedFees(token)).to.equal(unit(0.75));
      expect(await tUSD8.balanceOf(await gateway.getAddress())).to.equal(unit(0.75));
      await expect(gateway.withdrawFees(token)).to.be.revertedWithCustomError(gateway, "AmountMismatch");

      await time.setNextBlockTimestamp((await gateway.refundDeadline(current)) + 1n);
      await gateway.connect(other).crystallizeFee(current);
      await gateway.withdrawFees(token);
      expect(await gateway.reservedFees(token)).to.equal(0);
      expect(await tUSD8.balanceOf(await gateway.getAddress())).to.equal(0);
    });

    it("reserves per invoice and token, and refunds an unrelated invoice after a withdrawal", async function () {
      const usdt = await (await ethers.getContractFactory("USDTLikeMock")).deploy();
      const usdtAddress = await usdt.getAddress();
      const token = await tUSD8.getAddress();
      const gatewayAddress = await gateway.getAddress();
      await gateway.whitelistToken(usdtAddress, "USDTm", 6);
      await usdt.mint(customer.address, unit(40));
      const old = await payAmount(100, "ORDER-OLD");
      await time.increase(60);
      const current = await payAmount(200, "ORDER-CURRENT");
      const { logs } = await (await gateway.connect(merchant).createInvoice(
        usdtAddress, unit(40), await time.latest() + 3600, "ORDER-USDT", ethers.randomBytes(32)
      )).wait();
      const usdtId = gateway.interface.parseLog(logs[0]).args.invoiceId;
      await usdt.connect(customer).approve(gatewayAddress, unit(40));
      await gateway.connect(customer).pay(usdtId);
      await tUSD8.connect(merchant).approve(gatewayAddress, unit(199.5));

      await time.setNextBlockTimestamp((await gateway.refundDeadline(old)) + 1n);
      await gateway.connect(other).crystallizeFee(old);
      await expect(gateway.withdrawFees(usdtAddress)).to.be.revertedWithCustomError(gateway, "AmountMismatch");
      await gateway.withdrawFees(token);
      const before = await tUSD8.balanceOf(customer.address);
      await gateway.connect(merchant).refund(current, customer.address);
      expect((await tUSD8.balanceOf(customer.address)) - before).to.equal(unit(200));
      expect(await gateway.reservedFees(token)).to.equal(0);
      expect(await gateway.reservedFees(usdtAddress)).to.equal(unit(0.1));
      expect(await usdt.balanceOf(gatewayAddress)).to.equal(unit(0.1));
      await expect(gateway.connect(other).crystallizeFee(current)).to.be.revertedWithCustomError(gateway, "InvoiceNotPending");
    });

    it("allows refund at exactly paidAt + 30 days but never crystallization at that timestamp", async function () {
      const id = await payAmount(100, "ORDER-DEADLINE");
      const inv = await gateway.getInvoice(id);
      const deadline = await gateway.refundDeadline(id);
      const token = await tUSD8.getAddress();
      expect(await gateway.REFUND_WINDOW()).to.equal(2_592_000n);
      expect(deadline).to.equal(inv.paidAt + 2_592_000n);
      expect(deadline).to.be.gt(inv.expiresAt);
      await tUSD8.connect(merchant).approve(await gateway.getAddress(), unit(99.75));
      // The snapshot lets each transaction run against the exact same block timestamp.
      const snapshot = await ethers.provider.send("evm_snapshot", []);
      await time.setNextBlockTimestamp(deadline);
      await expect(gateway.connect(other).crystallizeFee(id))
        .to.be.revertedWithCustomError(gateway, "RefundWindowOpen");
      await ethers.provider.send("evm_revert", [snapshot]);
      await time.setNextBlockTimestamp(deadline);
      await expect(gateway.connect(merchant).refund(id, customer.address))
        .to.emit(gateway, "InvoiceRefunded").withArgs(id, customer.address, unit(100), deadline);
      expect(await gateway.reservedFees(token)).to.equal(0);
      expect(await gateway.pendingFees(token)).to.equal(0);
    });

    it("rejects a refund one second after the deadline, even before crystallization", async function () {
      const id = await payAmount(100, "ORDER-TOO-LATE");
      const token = await tUSD8.getAddress();
      await tUSD8.connect(merchant).approve(await gateway.getAddress(), unit(99.75));
      await time.setNextBlockTimestamp((await gateway.refundDeadline(id)) + 1n);
      await expect(gateway.connect(merchant).refund(id, customer.address))
        .to.be.revertedWithCustomError(gateway, "RefundWindowClosed");
      expect(await gateway.reservedFees(token)).to.equal(unit(0.25));
      expect(await gateway.pendingFees(token)).to.equal(0);
      await expect(gateway.connect(other).crystallizeFee(id)).to.emit(gateway, "FeeCrystallized");
      await expect(gateway.connect(merchant).refund(id, customer.address))
        .to.be.revertedWithCustomError(gateway, "RefundWindowClosed");
    });

    it("keeps refund authorization after deregistration, pausing and delisting", async function () {
      const id = await payAmount(100, "ORDER-DEREGISTERED");
      await gateway.deregisterMerchant(merchant.address);
      await gateway.delistToken(await tUSD8.getAddress());
      await gateway.setPaused(true);
      await tUSD8.connect(merchant).approve(await gateway.getAddress(), unit(99.75));
      await expect(gateway.connect(other).refund(id, customer.address))
        .to.be.revertedWithCustomError(gateway, "NotMerchant");
      await expect(gateway.connect(merchant).refund(id, other.address))
        .to.be.revertedWithCustomError(gateway, "WrongRefundRecipient");
      await expect(gateway.connect(merchant).refund(id, customer.address)).to.emit(gateway, "InvoiceRefunded");
    });

    it("leaves invoice and reserve intact when the merchant has not approved its share", async function () {
      const id = await payAmount(100, "ORDER-NO-ALLOWANCE");
      const token = await tUSD8.getAddress();
      const gatewayAddress = await gateway.getAddress();
      const payerBalance = await tUSD8.balanceOf(customer.address);
      await expect(gateway.connect(merchant).refund(id, customer.address))
        .to.be.revertedWithCustomError(gateway, "TransferFailed");
      expect(await gateway.isInvoicePaid(id)).to.equal(true);
      expect(await gateway.reservedFees(token)).to.equal(unit(0.25));
      expect(await tUSD8.balanceOf(gatewayAddress)).to.equal(unit(0.25));
      expect(await tUSD8.balanceOf(customer.address)).to.equal(payerBalance);
      await tUSD8.connect(merchant).approve(gatewayAddress, unit(99.75));
      await expect(gateway.connect(merchant).refund(id, customer.address)).to.emit(gateway, "InvoiceRefunded");
    });

    it("accounts for zero fees without moving funds or allowing a second crystallization", async function () {
      await gateway.setFeeBps(0);
      const token = await tUSD8.getAddress();
      const a = await payAmount(100, "ORDER-ZERO-A");
      const b = await payAmount(100, "ORDER-ZERO-B");
      const balanceBefore = await tUSD8.balanceOf(customer.address);
      await tUSD8.connect(merchant).approve(await gateway.getAddress(), unit(100));
      await gateway.connect(merchant).refund(b, customer.address);
      expect((await tUSD8.balanceOf(customer.address)) - balanceBefore).to.equal(unit(100));
      await gateway.setFeeBps(500);
      await time.setNextBlockTimestamp((await gateway.refundDeadline(a)) + 1n);
      await expect(gateway.connect(other).crystallizeFee(a))
        .to.emit(gateway, "FeeCrystallized").withArgs(a, token, 0);
      await expect(gateway.connect(other).crystallizeFee(a))
        .to.be.revertedWithCustomError(gateway, "FeeAlreadyCrystallized");
      expect(await gateway.reservedFees(token)).to.equal(0);
      expect(await gateway.pendingFees(token)).to.equal(0);
    });

    it("does not crystallize missing or unpaid invoices", async function () {
      const token = await tUSD8.getAddress();
      const { logs } = await (await gateway.connect(merchant).createInvoice(
        token, unit(10), await time.latest() + 3600, "ORDER-UNPAID", ethers.randomBytes(32)
      )).wait();
      const id = gateway.interface.parseLog(logs[0]).args.invoiceId;
      expect(await gateway.refundDeadline(ethers.ZeroHash)).to.equal(0);
      expect(await gateway.refundDeadline(id)).to.equal(0);
      await expect(gateway.crystallizeFee(ethers.ZeroHash)).to.be.revertedWithCustomError(gateway, "InvoiceNotFound");
      await expect(gateway.crystallizeFee(id)).to.be.revertedWithCustomError(gateway, "InvoiceNotPending");
    });

    it("rejects a fee withdrawal from a non-owner", async function () {
      await payAmount(100, "ORDER-F3");
      await expect(gateway.connect(other).withdrawFees(await tUSD8.getAddress()))
        .to.be.revertedWithCustomError(gateway, "NotOwner");
    });

    it("charges exactly feeBps across a range of amounts (property check)", async function () {
      await gateway.setFeeBps(125); // 1.25%
      const token = await tUSD8.getAddress();

      for (const amount of [1, 7, 33, 999, 1234.567891, 2500]) {
        const amountWei = unit(amount);
        const fee = (amountWei * 125n) / 10000n;
        const net = amountWei - fee;

        const merchantBefore = await tUSD8.balanceOf(merchant.address);
        const feesBefore = await gateway.reservedFees(token);

        await payAmount(amount, "ORDER-FUZZ-" + String(amount));

        const merchantAfter = await tUSD8.balanceOf(merchant.address);
        const feesAfter = await gateway.reservedFees(token);

        expect(merchantAfter - merchantBefore).to.equal(net);
        expect(feesAfter - feesBefore).to.equal(fee);
        expect(net + fee).to.equal(amountWei);
      }
    });
  });

});
