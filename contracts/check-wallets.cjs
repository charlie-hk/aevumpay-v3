const { ethers } = require("ethers")
const provider = new ethers.JsonRpcProvider(process.env.QDAY_RPC_URL || "https://rpc-test.qday.info")
const token = new ethers.Contract(
  "0x456569838f1d43009A91ebA4263147Afd7233483",
  ["function balanceOf(address) view returns (uint256)"],
  provider
)
const names = ["DEPLOYER_PRIVATE_KEY", "PAYER_PRIVATE_KEY", "CUSTOMER_PRIVATE_KEY", "AGENT_PRIVATE_KEY"]
const norm = (k) => (k.startsWith("0x") ? k : "0x" + k)
;(async () => {
  for (const name of names) {
    const raw = (process.env[name] || "").trim()
    if (!raw) { console.log(name.padEnd(22), "-> MISSING"); continue }
    let wallet
    try { wallet = new ethers.Wallet(norm(raw)) } catch { console.log(name.padEnd(22), "-> INVALID KEY"); continue }
    const gas = await provider.getBalance(wallet.address)
    const tok = await token.balanceOf(wallet.address)
    console.log(name.padEnd(22), wallet.address, "gas:", ethers.formatEther(gas), "tUSD8:", ethers.formatUnits(tok, 6))
  }
})().catch((e) => { console.error(e.message); process.exit(1) })
