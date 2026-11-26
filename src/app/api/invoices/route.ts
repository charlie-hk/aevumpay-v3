import { db, assertNoLegacyRowsForV3 } from '@/lib/db'
import { ethers } from 'ethers'
import { activeGatewayAddress, QDAY_NETWORK } from '@/lib/contracts'
import { NextRequest, NextResponse } from 'next/server'
import { maskEmail } from '@/lib/sanitize'
import { requireSession } from '@/lib/api-auth'
import { rejectMutation, sameOriginMutation, spendQuota } from '@/lib/request-guards'
import { checkedProvider, configuredToken, exactAmount, sameAddress } from '@/lib/checkout-proof'

/**
 * GET  /api/invoices?status=&token=&q=&limit=   → invoices for the signed-in merchant
 * POST /api/invoices                            → create an invoice for the signed-in merchant
 *
 * Both handlers are scoped to the session's merchant. A `merchantId` parameter
 * is accepted only when it matches the session; otherwise the request is
 * rejected with 403 (never silently widened to another merchant's data).
 */

const MERCHANT_SELECT = {
  id: true,
  name: true,
  businessName: true,
  walletAddress: true,
  avatarColor: true,
} as const

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const requestedMerchantId = searchParams.get('merchantId')

  const auth = await requireSession()
  if (!auth.ok) return auth.response
  if (requestedMerchantId && requestedMerchantId !== auth.actor.merchantId) {
    return NextResponse.json({ error: 'Forbidden for this merchant' }, { status: 403 })
  }

  const guard = await assertNoLegacyRowsForV3()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 })

  const status = searchParams.get('status')
  const token = searchParams.get('token')
  const q = searchParams.get('q')
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50') || 50, 1), 200)

  // Scoped to the session merchant — always.
  const where: Record<string, unknown> = { merchantId: auth.actor.merchantId }
  if (status && status !== 'ALL') where.status = status
  if (token && token !== 'ALL') where.token = token
  if (q) {
    where.OR = [
      { invoiceNumber: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { customerName: { contains: q, mode: 'insensitive' } },
      { customerEmail: { contains: q, mode: 'insensitive' } },
      { orderRef: { contains: q, mode: 'insensitive' } },
    ]
  }

  // Expire stale pending invoices — scoped to this merchant, on read.
  await db.invoice.updateMany({
    where: { merchantId: auth.actor.merchantId, status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })

  const invoices = await db.invoice.findMany({
    where,
    include: { merchant: { select: MERCHANT_SELECT }, transactions: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    invoices: invoices.map((inv) => ({ ...inv, customerEmail: maskEmail(inv.customerEmail) })),
  })
}

export async function POST(req: NextRequest) {
  if (!sameOriginMutation(req)) return rejectMutation()
  const auth = await requireSession()
  if (!auth.ok) return auth.response
  const guard = await assertNoLegacyRowsForV3()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid invoice.' }, { status: 400 })
  if (body.merchantId && body.merchantId !== auth.actor.merchantId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  const units = exactAmount(body.amount)
  const ttl = Number(body.expiresInMinutes ?? 60)
  if (!units || (body.token && body.token !== 'tUSD8') || (body.currency && body.currency !== 'USD') || !Number.isInteger(ttl) || ttl < 5 || ttl > 43200) {
    return NextResponse.json({ error: 'Use a valid USD/tUSD8 amount with up to 6 decimals and an expiry between 5 minutes and 30 days.' }, { status: 400 })
  }
  const limits = { customerEmail: 254, customerName: 100, description: 500, orderRef: 96 }
  if (Object.entries(limits).some(([key, max]) => body[key] != null && (typeof body[key] !== 'string' || body[key].length > max))) {
    return NextResponse.json({ error: 'Invoice text fields are too long or invalid.' }, { status: 400 })
  }
  const merchant = await db.merchant.findUnique({ where: { id: auth.actor.merchantId }, select: MERCHANT_SELECT })
  const address = activeGatewayAddress()
  const token = configuredToken()
  const key = process.env.DEPLOYER_PRIVATE_KEY
  if (!merchant || !address || !token || !key || !/^0x[0-9a-f]{64}$/i.test(key)) {
    return NextResponse.json({ error: 'This deployment does not have a configured invoice signer.' }, { status: 503 })
  }
  let wallet: ethers.Wallet
  try { wallet = new ethers.Wallet(key) } catch { return NextResponse.json({ error: 'Invalid server signer configuration.' }, { status: 503 }) }
  if (!sameAddress(wallet.address, merchant.walletAddress)) return NextResponse.json({ error: 'This account does not have a matching testnet signer.' }, { status: 403 })
  const quota = await spendQuota('merchant-create', auth.actor.merchantId, 8, 60)
  if (quota) return quota
  const invoiceNumber = `INV-${ethers.hexlify(ethers.randomBytes(8)).slice(2).toUpperCase()}`
  const orderRef = body.orderRef?.trim() || invoiceNumber
  const expiresAtSec = Math.floor(Date.now() / 1000) + ttl * 60
  const salt = ethers.hexlify(ethers.randomBytes(32))
  const amount = Number(ethers.formatUnits(units, 6))
  let provider: ethers.JsonRpcProvider | undefined
  let submitted: string | undefined
  try {
    provider = await checkedProvider()
    const gw = new ethers.Contract(address, [
      'function isMerchant(address) view returns (bool)',
      'function createInvoice(address,uint256,uint256,string,bytes32) returns (bytes32)',
      'event InvoiceCreated(bytes32 indexed invoiceId, address indexed merchant, address token, uint256 amount, uint256 expiresAt, string indexed orderRef)',
    ], wallet.connect(provider))
    if (!await gw.isMerchant(wallet.address)) return NextResponse.json({ error: 'This wallet is not registered on the configured gateway.' }, { status: 403 })
    const tx = await gw.createInvoice(token, units, expiresAtSec, orderRef, salt)
    submitted = tx.hash
    const receipt = await tx.wait(1, 35_000)
    if (!receipt || receipt.status !== 1 || !receipt.to || !sameAddress(receipt.to, address)) throw new Error('Missing successful invoice receipt.')
    const expectedId = ethers.solidityPackedKeccak256(['address','string','bytes32','uint256'], [wallet.address, orderRef, salt, QDAY_NETWORK.chainIdDec])
    const proof = receipt.logs.some((log: ethers.Log) => {
      if (!sameAddress(log.address, address)) return false
      const parsed = gw.interface.parseLog(log)
      return parsed?.name === 'InvoiceCreated' && parsed.args.invoiceId === expectedId && sameAddress(parsed.args.merchant, wallet.address) && sameAddress(parsed.args.token, token) && parsed.args.amount === units && parsed.args.expiresAt === BigInt(expiresAtSec)
    })
    if (!proof) throw new Error('Invoice event does not match the request.')
    const invoice = await db.invoice.create({ data: {
      invoiceNumber, merchantId: auth.actor.merchantId, amount, currency: 'USD', token: 'tUSD8',
      customerEmail: body.customerEmail || null, customerName: body.customerName || null, description: body.description || null,
      orderRef, onChainInvoiceId: expectedId, salt, onChainTxHash: receipt.hash, gatewayAddress: address.toLowerCase(), gatewayChainId: QDAY_NETWORK.chainIdDec,
      payAddress: merchant.walletAddress, payAmount: amount, expiresAt: new Date(expiresAtSec * 1000),
    }, include: { merchant: { select: MERCHANT_SELECT } } })
    return NextResponse.json({ invoice: { ...invoice, customerEmail: maskEmail(invoice.customerEmail) }, onChain: true })
  } catch {
    return NextResponse.json({ error: submitted ? `Invoice was submitted (${submitted}); reconcile the receipt before retrying.` : 'Could not issue the invoice on QDay.' }, { status: 502 })
  } finally { provider?.destroy() }
}
