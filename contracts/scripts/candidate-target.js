const path = require("path");

// Deliberately separate from the historical V2 deployments/qday.json record.
module.exports = {
  VERSION: "v3-candidate",
  REFUND_WINDOW: 30n * 24n * 60n * 60n,
  QDAY_CHAIN_ID: 44005n,
  QDAY_TOKEN: "0x456569838f1d43009A91ebA4263147Afd7233483",
  QDAY_DECIMALS: 6n,
  QDAY_EXPLORER: "https://explorer-test.qday.info",
  CANDIDATE_RECORD: path.join(__dirname, "..", "deployments", "qday-v3-candidate.json"),
};
