const { expect } = require("chai");
const { artifacts } = require("hardhat");
const solc = require("solc");
const v2Input = require("../verification/v2-standard-input.json");

// Compile only the old gateway ABI from its preserved verification input; no
// network or old deployment is needed. Compare names, types, tuple component
// order, mutability, constructor, events and errors, not just selectors.
describe("V2 ABI compatibility", function () {
  it("keeps every historical gateway ABI entry exactly", async function () {
    const source = "contracts/AevumPaymentGateway.sol";
    const name = "AevumPaymentGateway";
    const output = JSON.parse(solc.compile(JSON.stringify({
      ...v2Input,
      settings: { ...v2Input.settings, outputSelection: { [source]: { [name]: ["abi"] } } },
    })));
    expect((output.errors ?? []).filter(({ severity }) => severity === "error")).to.deep.equal([]);
    const previous = output.contracts[source][name].abi;
    const current = (await artifacts.readArtifact(name)).abi;
    for (const entry of previous) {
      expect(current, `${entry.type} ${entry.name ?? "constructor"}`).to.deep.include(entry);
    }
  });
});
