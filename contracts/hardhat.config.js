require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

const SOLC_VERSION = "0.8.24";
const SOLC_LONG_VERSION = "0.8.24+commit.e11b9ed9";

// Never download an implicit compiler. npm ci installs the pinned solc-js build.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }) => {
  const localVersion = require("solc").version().split(".Emscripten")[0];
  if (solcVersion !== SOLC_VERSION || localVersion !== SOLC_LONG_VERSION) {
    throw new Error(`Expected local solc ${SOLC_LONG_VERSION}; requested ${solcVersion}, found ${localVersion}. Run npm ci.`);
  }
  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: SOLC_VERSION,
    longVersion: SOLC_LONG_VERSION,
  };
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "paris",
    },
  },
  networks: {
    // Official Aevum testnet — verified from https://qday.io/build
    //   RPC:      https://rpc-test.qday.info
    //   Chain ID: 44005
    qday: {
      url: process.env.QDAY_RPC_URL || "https://rpc-test.qday.info",
      chainId: Number(process.env.QDAY_CHAIN_ID || 44005),
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
    hardhat: {
      chainId: 31337,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

