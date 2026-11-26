# V3: Agent spending mandates

A payer can let an AI agent pay invoices on their behalf, within limits that are enforced on-chain:

- `maxPerInvoice`: the most the agent can pay for any single invoice
- `totalCap`: the most the agent can spend in total
- `validUntil`: when the mandate expires
- `merchant`: limits the agent to one merchant (`address(0)` allows any registered merchant)
- `revokeMandate(agent)`: stops the agent right away, and works even while the gateway is paused

Funds move from the payer to the gateway to the merchant. The agent wallet never holds tUSD8, and refunds always go back to the payer.

## Contract API

```solidity
grantMandate(agent, token, merchant, maxPerInvoice, totalCap, validUntil)
payWithMandate(invoiceId, payer)        // called by the agent
revokeMandate(agent)                    // called by the payer
mandateRemaining(payer, agent) view
```

Events: `MandateGranted`, `MandatePayment`, `MandateRevoked`, `OwnershipTransferred`, `FeeCollectorUpdated`.

## Run locally (no wallet needed)

```bash
npm install
npm test                    # 52 tests
npm run demo:agent:local    # full mandate flow on an in-memory chain
```

## Run on QDay testnet

You need three different wallets, each with a little QDAY for gas. The payer wallet also needs at least 5 tUSD8 (official token `0x456569838f1d43009A91ebA4263147Afd7233483`, 6 decimals).

```bash
export DEPLOYER_PRIVATE_KEY=0x...      # owner + merchant
export PAYER_PRIVATE_KEY=0x...
export AGENT_PRIVATE_KEY=0x...

CONFIRM_V3_DEPLOY=v3-candidate npm run deploy   # writes deployments/qday-v3-candidate.json
npm run demo:agent                              # prints an explorer link for every transaction
```

Then verify the contract on the explorer (see `scripts/verify.js` / `npm run verify:gateway`).

Never commit private keys. Use testnet-only wallets.
