# AevumPay Gateway - Smart Contracts (V3)

Invoice-based stablecoin payment gateway with on-chain **agent spending mandates**, built for the Aevum Builder Challenge #1 on the QDay testnet. Uses the official 6-decimal test token tUSD8. Testnet software, not audited for mainnet.

## Deployed contract (V3, QDay testnet)

| Item | Value |
|---|---|
| Gateway | [`0x6935DC350d790A11FF227841130B9de1642A865a`](https://explorer-test.qday.info/address/0x6935DC350d790A11FF227841130B9de1642A865a#code) |
| Deployment tx | [`0xd03acd30418b451ffb78f4a67ca8f773f3ee59bbe5a2a8db66a019bc3519a137`](https://explorer-test.qday.info/tx/0xd03acd30418b451ffb78f4a67ca8f773f3ee59bbe5a2a8db66a019bc3519a137) (block 4,116,934) |
| Token | Official tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals) |
| Compiler | solc 0.8.24, optimizer 200 runs, `viaIR`, EVM `paris` |
| Refund window | 30 days from the on-chain payment time |
| Fee | 0.25% (25 bps, owner-configurable, capped at 5%) |

Full list of transactions and the demo run: [deployment-proof.md](deployment-proof.md).

Earlier versions are kept for history: V2 `0x21A07B6DC9b565F2734cE12b68A63Cc971A534aC` (verified, no mandates, no per-invoice fee reserve) and V1 `0x8D86d3fEE0c2420192d82716c82bc2e79585d5c9` (superseded: refunds accepted any recipient). See `deployments/`.

## Features

- A merchant creates an invoice (`createInvoice`); a customer pays it (`pay`). The merchant receives the net amount at once; the platform fee is reserved for that specific invoice.
- **Refunds** by the original merchant, only to the original payer, up to the exact 30-day deadline. The payer gets the full amount back (merchant net share plus the invoice's reserved fee).
- **Fee crystallization**: after the refund deadline anyone can release an invoice's reserved fee to the withdrawable pool (`crystallizeFee`). `withdrawFees` only spends released revenue.
- **Agent mandates**: a payer lets an AI agent pay invoices within on-chain limits (see [AGENT-MANDATE.md](AGENT-MANDATE.md)).
- Reentrancy guard on state-changing functions, pausable by the owner, token allowlist, exact-transfer checks (rebasing and fee-on-transfer tokens are not supported).

### Agent mandate API

```solidity
grantMandate(agent, token, merchant, maxPerInvoice, totalCap, validUntil)
payWithMandate(invoiceId, payer)   // called by the agent
revokeMandate(agent)               // called by the payer, works even while paused
mandateRemaining(payer, agent)     // view
```

## Architecture

```
Merchant --createInvoice()--> Gateway <--pay() / payWithMandate()-- Customer or Agent
                                |
                                +--> net amount to merchant
                                +--> fee reserved per invoice --> (30 days) --> crystallizeFee --> withdrawFees
                                +--> refund() returns net + reserved fee to the payer
```

## Run locally (no wallet needed)

Requires Node.js 22.

```bash
npm ci
npm test                    # 52 tests (invoices, refunds, fees, ABI, mandates)
npm run demo:local          # invoice payment on an in-memory chain
npm run demo:agent:local    # agent mandate flow on an in-memory chain
```

## Run on the QDay testnet

Network: chain ID `44005`, RPC `https://rpc-test.qday.info`, explorer `https://explorer-test.qday.info`.

1. `cp .env.example .env` and fill in the testnet keys (separate wallets for deployer, payer and agent; each needs a little QDAY for gas; the payer needs at least 5 tUSD8).
2. Deploy (this refuses to overwrite an existing record in `deployments/qday-v3-candidate.json`; archive it first if you want a fresh deployment):
   ```bash
   CONFIRM_V3_DEPLOY=v3-candidate npm run deploy
   ```
3. Verify the source on the explorer:
   ```bash
   npm run verify:gateway -- <gatewayAddress> <feeCollectorAddress>
   ```
   The script rebuilds the Standard JSON input from the local build so compiler, optimizer and `viaIR` always match. The explorer's single-file form cannot match `viaIR` builds.
4. Run the demos (each prints an explorer link for every transaction):
   ```bash
   V3_DEMO_GATEWAY=<gatewayAddress> npm run demo     # invoice, payment, refund
   npm run demo:agent                                # mandate, agent payment, revoke
   ```
5. `node check-wallets.cjs` prints gas and tUSD8 balances of the configured wallets.

## Files

| File | Purpose |
|---|---|
| `contracts/AevumPaymentGateway.sol` | Gateway: invoices, payments, refunds, fees, mandates |
| `contracts/IAevumPaymentGateway.sol` | Interface for integrations |
| `contracts/tUSD8.sol`, `contracts/mocks/*` | Local test tokens (tests only; testnet uses the official token) |
| `scripts/` | deploy, verify, demo-payment, demo-agent |
| `test/` | AevumPay, Mandate and ABI tests |
| `deployments/` | Deployment records (V3 current, V2 and V1 history) |

## Known limits

Not audited. Use testnet wallets only. Do not use rebasing or fee-on-transfer tokens. The 30-day refund window is a fixed policy of this version. MIT license.
