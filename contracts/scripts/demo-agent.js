/**
 * Agent spending-mandate demo.
 *
 * Local:  npm run demo:agent:local   (in-memory Hardhat chain, no real transactions)
 * QDay:   npm run demo:agent          (needs a deployed V3 candidate record)
 *
 * QDay env:
 *   DEPLOYER_PRIVATE_KEY  merchant wallet (registered as MERCHANT-001 by deploy.js), needs QDAY gas
 *   PAYER_PRIVATE_KEY     wallet holding tUSD8, needs QDAY gas
 *   AGENT_PRIVATE_KEY     agent wallet, needs QDAY gas only (never holds tUSD8)
 *
 * Flow: payer approves gateway -> payer grants mandate to agent -> merchant creates
 * invoice -> agent pays it from the payer's balance -> an over-limit invoice is
 * rejected -> payer revokes -> agent is blocked.
 */
const fs = require("node:fs");
const { ethers, network } = require("hardhat");
const { QDAY_CHAIN_ID, QDAY_TOKEN, QDAY_EXPLORER, CANDIDATE_RECORD } = require("./candidate-target");

const fmt = (v) => ethers.formatUnits(v, 6);

async function main() {
  const local = network.name === "hardhat";
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== (local ? 31337n : QDAY_CHAIN_ID)) throw new Error(`Unsupported chain: ${chainId}`);

  let merchant, payer, agent, token, gateway;

  if (local) {
    [merchant, payer, agent] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("tUSD8Mock")).deploy();
    gateway = await (await ethers.getContractFactory("AevumPaymentGateway")).deploy(merchant.address);
    await (await gateway.whitelistToken(await token.getAddress(), "tUSD8", 6)).wait();
    await (await gateway.registerMerchant(merchant.address, "MERCHANT-001")).wait();
    await (await token.mint(payer.address, ethers.parseUnits("100", 6))).wait();
  } else {
    if (!fs.existsSync(CANDIDATE_RECORD)) throw new Error("No V3 candidate record. Run npm run deploy first.");
    for (const k of ["PAYER_PRIVATE_KEY", "AGENT_PRIVATE_KEY"]) {
      if (!process.env[k]) throw new Error(`Set ${k}.`);
    }
    const record = JSON.parse(fs.readFileSync(CANDIDATE_RECORD, "utf8"));
    [merchant] = await ethers.getSigners();
    payer = new ethers.Wallet(process.env.PAYER_PRIVATE_KEY, ethers.provider);
    agent = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, ethers.provider);
    if (new Set([merchant.address, payer.address, agent.address]).size !== 3) {
      throw new Error("Merchant, payer and agent must be three different wallets.");
    }
    gateway = await ethers.getContractAt("AevumPaymentGateway", record.contracts.AevumPaymentGateway.address);
    token = await ethers.getContractAt("tUSD8Mock", QDAY_TOKEN);
  }

  const tokenAddress = await token.getAddress();
  const gatewayAddress = await gateway.getAddress();
  const link = (hash) => (local ? hash : `${QDAY_EXPLORER}/tx/${hash}`);
  const send = async (label, txPromise) => {
    const receipt = await (await txPromise).wait();
    console.log(`  ${label}: ${link(receipt.hash)}`);
    return receipt;
  };
  const createInvoice = async (amount, ref) => {
    const expiresAt = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    const receipt = await send(
      `invoice ${ref} (${amount} tUSD8)`,
      gateway.connect(merchant).createInvoice(
        tokenAddress, ethers.parseUnits(amount, 6), expiresAt, ref, ethers.hexlify(ethers.randomBytes(32))
      )
    );
    return receipt.logs.map((l) => { try { return gateway.interface.parseLog(l); } catch { return null; } })
      .find((l) => l?.name === "InvoiceCreated").args.invoiceId;
  };

  console.log(`Gateway ${gatewayAddress} on ${network.name}`);
  console.log(`Merchant ${merchant.address}\nPayer    ${payer.address}\nAgent    ${agent.address}`);
  const payerStart = await token.balanceOf(payer.address);
  if (payerStart < ethers.parseUnits("2", 6)) throw new Error(`Payer needs at least 2 tUSD8, has ${fmt(payerStart)}.`);

  console.log("\n1. Payer approves the gateway and grants the agent a mandate (2/invoice, 3 total, 1 day)");
  await send("approve", token.connect(payer).approve(gatewayAddress, ethers.parseUnits("3", 6)));
  const validUntil = (await ethers.provider.getBlock("latest")).timestamp + 86400;
  await send("grantMandate", gateway.connect(payer).grantMandate(
    agent.address, tokenAddress, merchant.address, ethers.parseUnits("2", 6), ethers.parseUnits("3", 6), validUntil
  ));

  const ref = () => `AGENT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  console.log("\n2. Agent pays a 2 tUSD8 invoice from the payer's balance");
  const ok = await createInvoice("2", ref());
  await send("payWithMandate", gateway.connect(agent).payWithMandate(ok, payer.address));
  console.log(`  remaining mandate: ${fmt(await gateway.mandateRemaining(payer.address, agent.address))} tUSD8`);
  console.log(`  agent tUSD8 balance: ${fmt(await token.balanceOf(agent.address))} (agent never holds funds)`);

  console.log("\n3. Agent tries a 2 tUSD8 invoice that would exceed the 3 tUSD8 cap");
  const over = await createInvoice("2", ref());
  try {
    await gateway.connect(agent).payWithMandate.staticCall(over, payer.address);
    throw new Error("Expected the cap to block this payment.");
  } catch (e) {
    const name = gateway.interface.parseError(e.data ?? e.error?.data ?? "0x")?.name;
    if (name !== "MandateCapExceeded") throw e;
    console.log("  blocked on-chain: MandateCapExceeded");
  }

  console.log("\n4. Payer revokes; the agent can no longer pay anything");
  await send("revokeMandate", gateway.connect(payer).revokeMandate(agent.address));
  try {
    await gateway.connect(agent).payWithMandate.staticCall(over, payer.address);
    throw new Error("Expected revoke to block this payment.");
  } catch (e) {
    const name = gateway.interface.parseError(e.data ?? e.error?.data ?? "0x")?.name;
    if (name !== "MandateInactive") throw e;
    console.log("  blocked on-chain: MandateInactive");
  }

  console.log(`\nPayer spent ${fmt(payerStart - (await token.balanceOf(payer.address)))} tUSD8. Demo complete.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
