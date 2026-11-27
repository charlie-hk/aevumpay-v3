# AevumPay

Live demo: [https://aevumpay-v3.vercel.app](https://aevumpay-v3.vercel.app)

**Invoice-based stablecoin payments with spending limits for AI agents, on the QDay testnet.**

Built for the [Aevum Builder Challenge #1](https://dorahacks.io/hackathon/qday/detail). A merchant issues an on-chain invoice in tUSD8 (the official 6-decimal test token). A customer, or an AI agent acting inside limits the customer set, pays it. The merchant is paid at once and every step is visible on the explorer.

Testnet software. Not audited for mainnet. Use testnet-only wallets.

## The problem

Merchants who accept stablecoins need invoices that can be reconciled against real chain data, refunds that cannot be abused, and a safe way to let software (including AI agents) pay on a user's behalf. Handing an agent a wallet key, or an unlimited token approval, is not safe.

## The solution

| Piece | What it does |
| --- | --- |
| **Gateway contract** (`contracts/`) | Invoices, payments, refunds (original payer only, 30-day window), per-invoice fee reserve, pausable, reentrancy-guarded. |
| **Agent mandates** | A payer grants an agent a mandate: max per invoice, total cap, expiry, optional single merchant. Enforced on-chain, revocable instantly (even while the gateway is paused). |
| **Merchant dashboard** (Next.js) | Create invoices, track payments and refunds, view transactions, inspect the contract. |
| **Public checkout** (`/pay/<id>`) | A customer connects a wallet and pays. The server accepts a payment only after checking the on-chain receipt against the invoice. |
| **Agent Mandates page** | Grant, inspect and revoke a mandate from your own wallet. |

## Architecture

```
                     +-----------------------------+
 Merchant dashboard  |  Next.js app (API routes)   |  PostgreSQL (Prisma)
 (session cookie) -> |  - verifies receipts        | <- invoices, transactions
                     |  - never exposes keys       |
                     +--------------+--------------+
                                    | ethers v6 / JSON-RPC
                                    v
 Customer wallet --pay()-----> AevumPaymentGateway (QDay testnet, chain 44005)
 AI agent wallet --payWithMandate()--^   |  net amount -> merchant
 Payer wallet --grantMandate()/revokeMandate()   |  fee reserved per invoice
                                                 |  refund() -> original payer
                                                 v
                                      tUSD8 (official, 6 decimals)
```

Core flows:

1. **Invoice and payment.** Merchant creates the invoice (`createInvoice`). Customer approves tUSD8 and calls `pay`. The app verifies the `InvoicePaid` event (gateway, invoice id, merchant, token, amount) and only then marks the invoice paid.
2. **Refund.** Only the original merchant, only to the original payer, up to the exact 30-day deadline. The payer receives the full amount (merchant net share plus the reserved fee).
3. **Agent payment.** Payer calls `grantMandate`. The agent calls `payWithMandate(invoiceId, payer)`. The contract checks token, merchant, limits and expiry. The agent wallet never holds funds. Payer can `revokeMandate` at any time.

## Deployed contracts (QDay testnet, chain ID 44005)

| Version | Address | Status |
| --- | --- | --- |
| **V3** (agent mandates, per-invoice fee reserve) | [`0x6935DC350d790A11FF227841130B9de1642A865a`](https://explorer-test.qday.info/address/0x6935DC350d790A11FF227841130B9de1642A865a#code) | Verified. Used by the live demo. Deployed 2026-11-25, block 4,116,934. Demo transactions: [contracts/deployment-proof.md](https://github.com/charlie-hk/aevumpay-v3/blob/main/contracts/deployment-proof.md) |
| V2 | [`0x21A07B6DC9b565F2734cE12b68A63Cc971A534aC`](https://explorer-test.qday.info/address/0x21A07B6DC9b565F2734cE12b68A63Cc971A534aC?tab=contract) | Verified (exact match). No mandates. Code default when no version is configured. |
| V1 | `0x8D86d3fEE0c2420192d82716c82bc2e79585d5c9` | Superseded (refunds accepted any recipient). History only. |

Token: official tUSD8 `0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals). RPC `https://rpc-test.qday.info`, explorer `https://explorer-test.qday.info`.

Which gateway does what: the live demo at https://aevumpay-v3.vercel.app runs invoices, checkout and agent mandates on V3. If no version is configured, the code falls back to V2. V3 mode requires a fresh database: V2 and V3 records must never be mixed, and the app refuses to serve mixed data in V3 mode.

V3 source is verified on the explorer. To verify a new deployment, run `npm run verify:gateway` in `contracts/` (see [contracts/README.md](https://github.com/charlie-hk/aevumpay-v3/blob/main/contracts/README.md)).

## Live demo evidence

All transactions are listed with explorer links in [contracts/deployment-proof.md](https://github.com/charlie-hk/aevumpay-v3/blob/main/contracts/deployment-proof.md):

- An invoice created and paid on the live V3 site (`createInvoice`, then `pay`).
- A mandate granted and then revoked from the Agent Mandates page (`grantMandate`, `revokeMandate`).
- A recorded agent flow on the V3 contract: grant, invoice, agent payment with `payWithMandate`, second invoice, revoke.

In the live-site test the same testnet wallet acted as merchant and payer. The contract allows this; the agent wallet must differ from the payer.

## Quick start

Requires Node.js 22 and a PostgreSQL database.

```shell
npm ci
cp .env.example .env        # fill in DATABASE_URL and SESSION_SECRET (see table below)
npm run db:generate
npm run db:push
npm run merchant:create -- 'merchant@example.com' 'YOUR_TESTNET_WALLET_ADDRESS' 'My merchant'
npm run dev                 # http://localhost:3000
```

`merchant:create` prints a random dashboard password once. Save it. The wallet must also be registered as a merchant on the gateway you use.

Checks: `npm run typecheck`, `npm run build`, and (app running) `npm run smoke:local`.

Contracts and tests (no wallet needed):

```shell
cd contracts
npm ci
npm test                    # 52 tests
npm run demo:local          # invoice payment on an in-memory chain
npm run demo:agent:local    # agent mandate flow on an in-memory chain
```

## Environment variables

See `.env.example` (app) and `contracts/.env.example` (contracts). Never commit `.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string (fresh, isolated database) |
| `SESSION_SECRET` | yes | 32+ characters; signs the HttpOnly session cookie |
| `NEXTAUTH_URL` | no | Public origin for same-origin checks on POST requests |
| `NEXT_PUBLIC_QDAY_RPC_URL` | no | RPC endpoint (default `https://rpc-test.qday.info`) |
| `NEXT_PUBLIC_AEVUMPAY_CONTRACT_VERSION` | no | `2` (code default) or `3` (used by the live demo) |
| `NEXT_PUBLIC_GATEWAY_ADDRESS` | no | V3 gateway address (used when version is `3`, and by the mandates page) |
| `DEPLOYER_PRIVATE_KEY` | no | Server-side merchant signer, testnet only. Must be `0x` followed by 64 hex characters, and its address must match the merchant wallet. Unset = read-only dashboard |
| `ALLOW_DEMO_SEED`, `SEED_MERCHANT_PASSWORD`, `DEMO_SETTLEMENT` | no | Development-only demo data |

## Using the agent mandate flow

In the app: sign in, open **Agent Mandates**, connect the payer wallet, enter the agent address and limits, confirm two wallet prompts (allowance, then mandate). The same page shows what is left to spend and revokes the mandate.

From the command line (three funded testnet wallets: deployer/merchant, payer, agent):

```shell
cd contracts
npm run demo:agent          # grant, create invoices, agent pays, over-limit attempt, revoke
```

Every transaction prints an explorer link. A recorded run is listed in [contracts/deployment-proof.md](https://github.com/charlie-hk/aevumpay-v3/blob/main/contracts/deployment-proof.md).

## Security notes

- Merchant authentication: scrypt password hashes, HMAC-signed HttpOnly session cookie, same-origin checks on mutations, request quotas. No secret reaches the browser.
- Payments are accepted only after the server matches the on-chain receipt to the invoice (gateway, chain, merchant, token, exact amount, timing).
- Contract: reentrancy guard, token allowlist, exact-transfer checks, refund to original payer only, mandate revoke works while paused.
- Demo and seed rows are labelled and excluded from every accounting figure.

## Known limits

- Testnet only and unaudited. A mainnet design would use merchant-owned wallet signing instead of one server-side signer.
- Webhooks are logged simulations, not signed HTTP deliveries. The support bot is rule-based.
- Amounts are stored as `Float` in the legacy database model; matching is done in token units against chain data. No reorg-aware settlement indexer yet.
- Rebasing and fee-on-transfer tokens are not supported. No post-quantum signing or permit support is claimed.

## Roadmap

Signed webhook delivery, a settlement indexer with reorg handling, per-merchant signing, mandate event history in the UI, an SDK package for agent frameworks.

## Repository layout

```
src/            Next.js app (dashboard, checkout, API routes)
prisma/         Database schema
contracts/      Solidity contracts, tests, deploy/verify/demo scripts, deployment records
public/         SDK snippet and bundled contract sources
scripts/        Merchant provisioning and local smoke test
```

## Built with

Solidity 0.8.24 (OpenZeppelin 5), Hardhat, Next.js 16, React 19, TypeScript, Prisma 6, PostgreSQL, ethers v6, Tailwind CSS, shadcn/ui.

## Timeline

Deployments: V1 on 2026-11-20, V2 and V3 on 2026-11-25 (see `contracts/deployments/`).

MIT License.
