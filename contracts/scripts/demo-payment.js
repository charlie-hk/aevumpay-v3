/**
 * Local: npm run demo:local (fresh in-process Hardhat chain; no live transactions).
 * QDay: V3_DEMO_GATEWAY=<candidate address> npm run demo (funded customer required).
 * The QDay path validates the explicit address, candidate record and exact local artifact
 * before submitting transactions; there is no fallback to the historical V2 record.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { artifacts, ethers, network } = require("hardhat");
const {
  VERSION, REFUND_WINDOW, QDAY_CHAIN_ID, QDAY_TOKEN, QDAY_DECIMALS, QDAY_EXPLORER, CANDIDATE_RECORD,
} = require("./candidate-target");

async function main() {
  const local = network.name === "hardhat";
  if (!local) {
    if (network.name !== "qday") throw new Error(`Unsupported demo network: ${network.name}`);
    if (!process.env.V3_DEMO_GATEWAY) throw new Error("Set V3_DEMO_GATEWAY to the intended V3 candidate address.");
    if (!fs.existsSync(CANDIDATE_RECORD)) throw new Error("No QDay V3 candidate record. The V2 deployment is not a demo target.");
  }
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== (local ? 31337n : QDAY_CHAIN_ID)) throw new Error(`Unsupported demo chain: ${chainId}`);
  const [merchant, localCustomer, caller] = await ethers.getSigners();
  if (!merchant) throw new Error("No merchant signer configured.");
  const Gateway = await ethers.getContractFactory("AevumPaymentGateway");
  let token, gateway, customer;

  if (local) {
    token = await (await ethers.getContractFactory("tUSD8Mock")).deploy();
    await token.waitForDeployment();
    gateway = await Gateway.deploy(merchant.address);
    await gateway.waitForDeployment();
    customer = localCustomer;
    await (await gateway.whitelistToken(await token.getAddress(), "tUSD8", QDAY_DECIMALS)).wait();
    await (await gateway.registerMerchant(merchant.address, "LOCAL-DEMO")).wait();
    await (await token.mint(customer.address, ethers.parseUnits("10", QDAY_DECIMALS))).wait();
  } else {
    const address = ethers.getAddress(process.env.V3_DEMO_GATEWAY);
    const record = JSON.parse(fs.readFileSync(CANDIDATE_RECORD, "utf8"));
    const gatewayRecord = record.contracts?.AevumPaymentGateway;
    const tokenRecord = record.contracts?.tUSD8;
    if (record.version !== VERSION || record.network !== network.name || record.chainId !== Number(chainId) ||
        record.refundWindowSeconds !== Number(REFUND_WINDOW) || gatewayRecord?.address !== address ||
        tokenRecord?.address !== QDAY_TOKEN || tokenRecord?.decimals !== Number(QDAY_DECIMALS) || tokenRecord?.official !== true) {
      throw new Error("Explicit target, network or token does not match the QDay V3 candidate record.");
    }
    const code = await ethers.provider.getCode(address);
    const artifact = await artifacts.readArtifact("AevumPaymentGateway");
    if (code === "0x" || code !== artifact.deployedBytecode || ethers.keccak256(code) !== gatewayRecord.runtimeCodeHash) {
      throw new Error("Target code does not exactly match the local V3 build and the candidate record.");
    }
    if (await ethers.provider.getCode(QDAY_TOKEN) === "0x") throw new Error("Official tUSD8 has no code.");
    token = await ethers.getContractAt([
      "function decimals() view returns (uint8)",
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
    ], QDAY_TOKEN);
    gateway = Gateway.attach(address);
    if (!process.env.CUSTOMER_PRIVATE_KEY) throw new Error("Provide a separately funded CUSTOMER_PRIVATE_KEY; this script does not fund wallets.");
    customer = new ethers.Wallet(process.env.CUSTOMER_PRIVATE_KEY, ethers.provider);
  }

  const gatewayAddress = await gateway.getAddress();
  const tokenAddress = await token.getAddress();
  const decimals = await token.decimals();
  const tokenInfo = await gateway.tokens(tokenAddress);
  assert.equal(decimals, QDAY_DECIMALS, "Unexpected token decimals");
  assert.equal(tokenInfo.decimals, decimals, "Unexpected gateway token decimals");
  assert.equal(tokenInfo.supported, true, "Token not whitelisted");
  assert.equal(await gateway.paused(), false, "Gateway is paused");
  assert.equal(await gateway.isMerchant(merchant.address), true, "Demo merchant is not registered");
  assert.equal(await gateway.REFUND_WINDOW(), REFUND_WINDOW, "Unexpected candidate refund policy");
  assert.notEqual(customer.address, merchant.address, "Demo must use a separate payer and merchant");
  assert(await token.balanceOf(customer.address) >= ethers.parseUnits("3", decimals), "Customer needs at least 3 tUSD8");
  assert(await ethers.provider.getBalance(customer.address) > 0n, "Customer needs gas");
  assert(await ethers.provider.getBalance(merchant.address) > 0n, "Merchant needs gas");
  console.log(`AevumPay ${VERSION} demo on ${network.name} (${chainId})`);
  console.log(`Gateway ${gatewayAddress}; token ${tokenAddress}; merchant ${merchant.address}; payer ${customer.address}`);

  async function report(label, tx) {
    const receipt = await tx.wait();
    console.log(`  ${label}: ${local ? tx.hash : `${QDAY_EXPLORER}/tx/${tx.hash}`}`);
    return receipt;
  }

  function event(receipt, name) {
    for (const log of receipt.logs) {
      if (log.address !== gatewayAddress) continue;
      const parsed = gateway.interface.parseLog(log);
      if (parsed?.name === name) return parsed.args;
    }
    throw new Error(`Missing ${name} in ${receipt.hash}`);
  }

  async function approve(signer, amount, label) {
    const connected = token.connect(signer);
    if (await token.allowance(signer.address, gatewayAddress) > 0n) {
      await report(`${label} reset`, await connected.approve(gatewayAddress, 0));
    }
    await report(label, await connected.approve(gatewayAddress, amount));
  }

  async function createAndPay(amountString, label) {
    const amount = ethers.parseUnits(amountString, decimals);
    const { timestamp } = await ethers.provider.getBlock("latest");
    const latestReserve = await gateway.reservedFees(tokenAddress);
    const merchantBalance = await token.balanceOf(merchant.address);
    const create = await gateway.connect(merchant).createInvoice(
      tokenAddress, amount, timestamp + 3600, `V3-DEMO-${label}`, ethers.randomBytes(32)
    );
    const { invoiceId } = event(await report(`create ${label}`, create), "InvoiceCreated");
    await approve(customer, amount, `payer approval ${label}`);
    const paid = await report(`pay ${label}`, await gateway.connect(customer).pay(invoiceId));
    const { networkFee: fee, paidAt } = event(paid, "InvoicePaid");
    assert.equal(await token.balanceOf(merchant.address), merchantBalance + amount - fee, "Incorrect merchant net");
    assert.equal(await gateway.reservedFees(tokenAddress), latestReserve + fee, "Incorrect reserve after payment");
    assert.equal(await gateway.refundDeadline(invoiceId), paidAt + REFUND_WINDOW);
    assert.equal(await gateway.isInvoicePaid(invoiceId), true);
    console.log(`  invoice ${label}: ${invoiceId}; fee reserved ${ethers.formatUnits(fee, decimals)} tUSD8`);
    return { invoiceId, amount, fee };
  }

  const initialReserve = await gateway.reservedFees(tokenAddress);
  const initialPending = await gateway.pendingFees(tokenAddress);
  const a = await createAndPay("2", "A");
  const b = await createAndPay("1", "B");
  const payerBefore = await token.balanceOf(customer.address);
  await approve(merchant, b.amount - b.fee, "merchant net approval B");
  await report("refund B", await gateway.connect(merchant).refund(b.invoiceId, customer.address));
  assert.equal(await token.balanceOf(customer.address), payerBefore + b.amount, "Payer did not receive full amount");
  assert.equal((await gateway.getInvoice(b.invoiceId)).status, 3n);
  assert.equal(await gateway.reservedFees(tokenAddress), initialReserve + a.fee, "Refund changed another reserve");
  assert.equal(await gateway.pendingFees(tokenAddress), initialPending, "Refund changed withdrawable fees");

  if (local) {
    // Local only: advance the Hardhat clock, crystallize as a non-owner, then withdraw.
    const collectorBefore = await token.balanceOf(merchant.address);
    const deadline = await gateway.refundDeadline(a.invoiceId);
    await network.provider.send("evm_setNextBlockTimestamp", [Number(deadline + 1n)]);
    const released = await report("crystallize A", await gateway.connect(caller).crystallizeFee(a.invoiceId));
    assert.equal(event(released, "FeeCrystallized").amount, a.fee);
    assert.equal(await gateway.isInvoicePaid(a.invoiceId), true);
    assert.equal(await gateway.reservedFees(tokenAddress), initialReserve);
    assert.equal(await gateway.pendingFees(tokenAddress), initialPending + a.fee);
    await report("withdraw crystallized fee", await gateway.withdrawFees(tokenAddress));
    assert.equal(await gateway.pendingFees(tokenAddress), 0n);
    assert.equal(await token.balanceOf(merchant.address), collectorBefore + a.fee);
  } else {
    console.log(`  A stays reserved until someone crystallizes it after ${await gateway.refundDeadline(a.invoiceId)} (Unix time).`);
  }
  console.log("Demo assertions passed.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
