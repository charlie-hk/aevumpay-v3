/**
 * Export the exact local V3 Standard JSON input (offline):
 *   npm run verify:gateway -- --export-standard-input /tmp/v3-standard-input.json
 *
 * Submit that input to Blockscout for an explicit V3 candidate address:
 *   npm run verify:gateway -- <candidateAddress> <feeCollector>
 *
 * Run `npm run compile` first. For the historical V2 artifact, see
 * verification/v2-standard-input.json instead.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config();
const { CANDIDATE_RECORD, VERSION } = require("./candidate-target");

const EXPLORER = process.env.QDAY_EXPLORER_URL || "https://explorer-test.qday.info";
const CONTRACT = "AevumPaymentGateway";
const SOURCE_PATH = "contracts/AevumPaymentGateway.sol";

/** Resolve the build-info file referenced by the current gateway artifact. */
function loadBuildInfo() {
  const artifactDir = path.join(__dirname, "..", "artifacts", SOURCE_PATH);
  const debugPath = path.join(artifactDir, `${CONTRACT}.dbg.json`);
  if (!fs.existsSync(debugPath)) throw new Error("Gateway build-info missing — run `npm run compile` first.");
  const debug = JSON.parse(fs.readFileSync(debugPath, "utf8"));
  const info = JSON.parse(fs.readFileSync(path.resolve(artifactDir, debug.buildInfo), "utf8"));
  const runtime = info.output.contracts?.[SOURCE_PATH]?.[CONTRACT]?.evm?.deployedBytecode?.object;
  const currentSource = fs.readFileSync(path.join(__dirname, "..", SOURCE_PATH), "utf8");
  if (!runtime || info.input.sources?.[SOURCE_PATH]?.content !== currentSource) {
    throw new Error("Build-info is stale or missing gateway bytecode. Run `npm run compile`.");
  }
  return { info, runtimeHash: ethers.keccak256(`0x${runtime}`) };
}

async function post(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return res.json();
}

async function main() {
  const [target, arg, ...rest] = process.argv.slice(2);
  if (!target || !arg || rest.length) {
    throw new Error("Usage: node scripts/verify.js --export-standard-input <file> OR <candidateAddress> <feeCollector>");
  }
  const { info, runtimeHash } = loadBuildInfo();
  const standardInput = info.input;
  if (target === "--export-standard-input") {
    fs.writeFileSync(arg, `${JSON.stringify(standardInput, null, 2)}\n`, { flag: "wx" });
    console.log(`Exported exact V3 compiler input to ${arg}`);
    return;
  }

  const address = ethers.getAddress(target);
  const feeCollector = ethers.getAddress(arg);
  if (!fs.existsSync(CANDIDATE_RECORD)) throw new Error("No QDay V3 candidate deployment to verify.");
  const record = JSON.parse(fs.readFileSync(CANDIDATE_RECORD, "utf8"));
  const gateway = record.contracts?.AevumPaymentGateway;
  if (record.version !== VERSION || record.network !== "qday" || gateway?.address !== address ||
      gateway?.constructorArgs?.feeCollector !== feeCollector || gateway?.runtimeCodeHash !== runtimeHash) {
    throw new Error("Target, constructor or local build does not match the V3 candidate record.");
  }
  const compiler = `v${info.solcLongVersion}`;
  const encodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [feeCollector]).slice(2);

  console.log("Contract :", address);
  console.log("Compiler :", compiler);
  console.log("Settings :", JSON.stringify(standardInput.settings.optimizer), "viaIR:", standardInput.settings.viaIR);
  console.log("CtorArgs :", encodedArgs || "(none)");
  console.log("\nSubmitting to", EXPLORER, "…");

  const submitted = await post(`${EXPLORER}/api`, {
    module: "contract",
    action: "verifysourcecode",
    apikey: process.env.QDAY_EXPLORER_API_KEY || "",
    contractaddress: address,
    sourceCode: JSON.stringify(standardInput),
    codeformat: "solidity-standard-json-input",
    contractname: `${SOURCE_PATH}:${CONTRACT}`,
    compilerversion: compiler,
    constructorArguements: encodedArgs,
  });

  if (submitted.status !== "1") {
    const reason = String(submitted.result || submitted.message || "");
    if (/already verified/i.test(reason)) {
      console.log(`✓ Already verified: ${EXPLORER}/address/${address}#code`);
      return;
    }
    console.error("Rejected:", reason);
    process.exit(1);
  }

  const guid = submitted.result;
  console.log("GUID:", guid, "— polling…");

  for (let attempt = 1; attempt <= 40; attempt++) {
    await new Promise((r) => setTimeout(r, 6000));
    const status = await post(`${EXPLORER}/api`, {
      module: "contract",
      action: "checkverifystatus",
      guid,
    });
    const result = String(status.result || "");
    process.stdout.write(`  [${attempt}] ${result}\n`);

    if (/Pass|Already/i.test(result)) {
      console.log(`\n✓ Verified: ${EXPLORER}/address/${address}#code`);
      return;
    }
    if (/Fail/i.test(result)) {
      console.error("\n✗ Verification failed — check the compiler settings / source revision.");
      process.exit(1);
    }
  }
  console.error("Timed out waiting for the verifier.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
