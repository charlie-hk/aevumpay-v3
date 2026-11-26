import { NextResponse } from 'next/server'
import { seedingEnabled } from '@/lib/db'
import { hashPassword } from '@/lib/api-auth'

/**
 * POST /api/seed → populate demo fixtures (development only, opt-in).
 *
 * Guards:
 *   1. Disabled in production, and in development only with ALLOW_DEMO_SEED=true.
 *   2. Seeded merchants can only be signed into when SEED_MERCHANT_PASSWORD is
 *      set — otherwise they have no password hash and login fails closed.
 *   3. Every fixture invoice/transaction is recorded with
 *      settlementSource = HISTORICAL_SEED: no tx hash, no block, and excluded
 *      from every dashboard accounting figure.
 *   4. Demo webhooks are created inactive; no outbound HTTP is dispatched.
 */
export async function POST() {
  if (!seedingEnabled()) {
    return NextResponse.json(
      {
        error:
          'Demo seeding is disabled. It is never available in production and requires ' +
          'ALLOW_DEMO_SEED=true in development.',
      },
      { status: 403 },
    )
  }

  try {
    const { db } = await import('@/lib/db')

    const existing = await db.merchant.findFirst({ where: { email: 'amini@aevumpay.io' } })
    if (existing) {
      return NextResponse.json({ ok: true, message: 'Already seeded' })
    }

    const seedPassword = process.env.SEED_MERCHANT_PASSWORD
    const passwordHash = seedPassword ? hashPassword(seedPassword) : null

    const merchantsData = [
      {
        email: 'amini@aevumpay.io',
        name: 'Amini',
        businessName: 'AevumPay Labs',
        walletAddress: '0x7F6f8d310dD5523D2B222c61Bb013c6a80ddB66E',
        avatarColor: '#00DC82',
      },
      {
        email: 'nova@nftgallery.xyz',
        name: 'Nova Chen',
        businessName: 'Nova NFT Gallery',
        walletAddress: '0x2546BcD3c84621e976D8181a1714A4595401eC7f',
        avatarColor: '#8B5CF6',
      },
      {
        email: 'kai@decoffee.io',
        name: 'Kai Tanaka',
        businessName: 'DeCoffee DAO',
        walletAddress: '0xcd3B766CCD6A733931338e0b593362EC7b09eC7C',
        avatarColor: '#22D3EE',
      },
    ]

    const merchants: { id: string; walletAddress: string }[] = []
    for (const m of merchantsData) {
      const created = await db.merchant.create({
        data: { ...m, passwordHash },
        select: { id: true, walletAddress: true },
      })
      merchants.push(created)
    }

    const tokens = ['tUSD8', 'USDT'] as const
    const statuses = ['PAID', 'PAID', 'PENDING', 'EXPIRED', 'REFUNDED'] as const
    const descriptions = [
      'Pro Plan — Annual Subscription',
      'Genesis NFT Mint Pass',
      'Premium Coffee Box — Monthly',
      'Whitelabel Gateway License',
      'DAO Membership Tier 3',
      'Web3 Workshop Ticket',
      'API Credits — 10,000 requests',
      'Limited Edition Merch Hoodie',
    ]
    const customerNames = ['Alex Rivera', 'Maya Patel', 'Lucas Müller', 'Yuki Sato', 'Omar Hassan', 'Sofia Rossi', 'Daniel Park', 'Lena Berg']
    const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)]
    const randAmount = () => Math.round((Math.random() * 980 + 20) * 100) / 100

    let count = 1000
    for (let i = 0; i < 40; i++) {
      const merchant = pick(merchants)
      const token = pick(tokens)
      const status = pick(statuses)
      const amount = randAmount()
      const createdAt = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
      const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)
      const settled = status === 'PAID' || status === 'REFUNDED'
      const paidAt = settled ? new Date(createdAt.getTime() + Math.random() * 30 * 60 * 1000) : null

      const invoice = await db.invoice.create({
        data: {
          invoiceNumber: `INV-DEMO-${++count}`,
          merchantId: merchant.id,
          amount,
          currency: 'USD',
          token,
          customerEmail: `customer${i}@example.com`,
          customerName: pick(customerNames),
          description: pick(descriptions),
          orderRef: `ORDER-${10000 + i}`,
          status,
          payAddress: merchant.walletAddress,
          payAmount: amount,
          // Fixture data: nothing on-chain, clearly labelled.
          onChainInvoiceId: null,
          gatewayAddress: null,
          gatewayChainId: null,
          txHash: null,
          payerAddress: null,
          blockNumber: null,
          networkFee: settled ? amount * 0.0025 : null,
          settlementSource: settled ? 'HISTORICAL_SEED' : null,
          expiresAt,
          paidAt,
          createdAt,
        },
      })

      if (paidAt) {
        await db.transaction.create({
          data: {
            invoiceId: invoice.id,
            txHash: `historical-seed:${invoice.id}`,
            fromAddress: 'HISTORICAL_SEED',
            toAddress: merchant.walletAddress,
            amount,
            token,
            blockNumber: 0,
            status: 'CONFIRMED',
            networkFee: amount * 0.0025,
            confirmations: 0,
            source: 'HISTORICAL_SEED',
            createdAt: paidAt,
          },
        })
      }
    }

    await db.webhook.createMany({
      data: [
        {
          merchantId: merchants[0].id,
          url: 'https://example.invalid/aevumpay/demo-webhook',
          events: 'invoice.paid,invoice.created,invoice.expired',
          isActive: false,
        },
        {
          merchantId: merchants[1].id,
          url: 'https://example.invalid/nftgallery/demo-webhook',
          events: 'invoice.paid,invoice.refunded',
          isActive: false,
        },
      ],
    })

    return NextResponse.json({
      ok: true,
      message: 'Seeded demo fixtures',
      note:
        'All seeded invoices and transactions are marked HISTORICAL_SEED and are excluded from ' +
        'dashboard accounting. Demo webhooks are inactive; no outbound HTTP is dispatched.',
      merchants: merchants.length,
      invoices: 40,
      demoLogin: seedPassword
        ? 'Sign in with SEED_MERCHANT_PASSWORD.'
        : 'Disabled: SEED_MERCHANT_PASSWORD is unset, so the seeded accounts have no password.',
    })
  } catch (err) {
    console.error('Seed error:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

/** Seeding mutates data, so a GET must never trigger it. */
export function GET() {
  return NextResponse.json({ error: 'Use POST /api/seed.' }, { status: 405 })
}
