/**
 * Deploy the V3 candidate. `npm run deploy:local` uses an ephemeral Hardhat chain.
 * Remote deployment is disabled unless explicitly opted in after policy approval.
 * Do not point a V2 app at this deployment without a separate cutover plan.
 */
const fs = require("fs");
const { artifacts, ethers, network } = require("hardhat");
const {
  VERSION, REFUND_WINDOW, QDAY_CHAIN_ID, QDAY_TOKEN, QDAY_DECIMALS, QDAY_EXPLORER, CANDIDATE_RECORD,
} = require("./candidate-target");

async function main() {
  const local = network.name === "hardhat";
  if (!local) {
    if (network.name !== "qday") throw new Error(`Unsupported deployment network: ${network.name}`);
    if (process.env.CONFIRM_V3_DEPLOY !== VERSION) {
      throw new Error("V3 is a draft. Set CONFIRM_V3_DEPLOY=v3-candidate only after approving the refund policy and deployment.");
    }
    if (fs.existsSync(CANDIDATE_RECORD)) {
      throw new Error("Candidate record already exists; archive it explicitly before redeploying.");
    }
    if (process.env.TUSD8_ADDRESS && ethers.getAddress(process.env.TUSD8_ADDRESS) !== QDAY_TOKEN) {
      throw new Error("QDay deployment requires the official tUSD8 address.");
    }
    if (process.env.TUSD8_DECIMALS && Number(process.env.TUSD8_DECIMALS) !== Number(QDAY_DECIMALS)) {
      throw new Error("QDay deployment requires six-decimal tUSD8.");
    }
  }

  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== (local ? 31337n : QDAY_CHAIN_ID)) throw new Error(`Unsupported deployment chain: ${chainId}`);
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer configured.");
  const source = "contracts/AevumPaymentGateway.sol:AevumPaymentGateway";
  const artifact = await artifacts.readArtifact(source);
  const build = await artifacts.getBuildInfo(source);
  if (!build) throw new Error("No gateway build info. Run npm run compile.");

  let token;
  if (local) {
    token = await (await ethers.getContractFactory("tUSD8Mock")).deploy();
    await token.waitForDeployment();
  } else {
    if (await ethers.provider.getCode(QDAY_TOKEN) === "0x") throw new Error("Official tUSD8 has no code on target chain.");
    token = await ethers.getContractAt([
      "function decimals() view returns (uint8)",
      "function balanceOf(address) view returns (uint256)",
    ], QDAY_TOKEN);
  }
  const tokenAddress = await token.getAddress();
  const decimals = await token.decimals();
  if (decimals !== QDAY_DECIMALS) throw new Error(`Expected six-decimal tUSD8, got ${decimals}.`);

  const Gateway = await ethers.getContractFactory("AevumPaymentGateway");
  const gateway = await Gateway.deploy(deployer.address);
  const deployment = await gateway.deploymentTransaction().wait();
  const gatewayAddress = await gateway.getAddress();
  console.log(`Deployed ${VERSION} gateway at ${gatewayAddress} (transaction ${deployment.hash}).`);
  const code = await ethers.provider.getCode(gatewayAddress);
  if (code !== artifact.deployedBytecode || await gateway.REFUND_WINDOW() !== REFUND_WINDOW) {
    throw new Error("Deployed bytecode or refund policy does not match local V3 build.");
  }

  const whitelist = await (await gateway.whitelistToken(tokenAddress, "tUSD8", decimals)).wait();
  const merchant = await (await gateway.registerMerchant(deployer.address, "MERCHANT-001")).wait();
  const txInfo = (receipt) => ({ tx: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() });
  const { evmVersion, optimizer, viaIR } = build.input.settings;
  const record = {
    version: VERSION,
    network: network.name,
    chainId: Number(chainId),
    explorer: local ? null : QDAY_EXPLORER,
    refundWindowSeconds: Number(REFUND_WINDOW),
    deployedAt: new Date((await ethers.provider.getBlock(deployment.blockNumber)).timestamp * 1000).toISOString(),
    deployer: deployer.address,
    contracts: {
      tUSD8: { address: tokenAddress, decimals: Number(decimals), official: !local },
      AevumPaymentGateway: {
        address: gatewayAddress,
        ...txInfo(deployment),
        runtimeCodeHash: ethers.keccak256(code),
        constructorArgs: { feeCollector: deployer.address },
        verified: false,
        compiler: `v${build.solcLongVersion}`,
        evmVersion,
        optimizer,
        viaIR,
      },
    },
    setupTransactions: [
      { step: "whitelistToken", ...txInfo(whitelist) },
      { step: "registerMerchant", ...txInfo(merchant) },
    ],
  };

  if (local) {
    console.log(JSON.stringify(record, null, 2));
    console.log("The in-process local chain ends with this command. Run npm run demo:local for a fresh complete demo.");
    return;
  }
  fs.writeFileSync(CANDIDATE_RECORD, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  console.log(`Saved ${CANDIDATE_RECORD}. The V2 record was not changed.`);
  console.log(`Testnet token balance: ${ethers.formatUnits(await token.balanceOf(deployer.address), decimals)} tUSD8`);
  console.log(`For the testnet demo: V3_DEMO_GATEWAY=${gatewayAddress} npm run demo`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
