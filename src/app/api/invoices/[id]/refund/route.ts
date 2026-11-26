import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { CONTRACT_VERSION } from '@/lib/contracts'
import { requireSession } from '@/lib/api-auth'
import { rejectMutation, sameOriginMutation, spendQuota } from '@/lib/request-guards'
import { checkedProvider, configuredToken, currentInvoiceGateway, sameAddress } from '@/lib/checkout-proof'

/**
 * POST /api/invoices/[id]/refund
 *
 * Server-side (merchant-side) refund. The server holds the merchant key
 * (DEPLOYER_PRIVATE_KEY) — the same wallet that created the invoice on-chain.
 *
 * Contract logic (AevumPaymentGateway.refund):
 *   - pulls the merchant's net share (amount - fee) from the merchant wallet
 *   - releases the escrowed platform fee
 *   - forwards BOTH to the original payer — the customer is made whole.
 *
 * Two transactions: tUSD8.approve(net) + gateway.refund(invoiceId, payer).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOriginMutation(req)) return rejectMutation()
  const { id } = await params

  // Only the signed-in merchant that owns the invoice may refund it.
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      merchant: {
        select: { id: true, name: true, businessName: true, walletAddress: true, avatarColor: true },
      },
    },
  })
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }
  // Ownership check — never operate on another merchant's invoice.
  if (invoice.merchantId !== auth.actor.merchantId) {
    return NextResponse.json({ error: 'Forbidden for this merchant' }, { status: 403 })
  }
  const gatewayAddress = currentInvoiceGateway(invoice)
  const tokenAddress = configuredToken()
  if (!gatewayAddress || !tokenAddress || invoice.token !== 'tUSD8') return NextResponse.json({ error: 'This invoice is not bound to the current supported gateway.' }, { status: 409 })
  if (invoice.settlementSource !== 'ONCHAIN') {
    return NextResponse.json(
      { error: 'Only on-chain settlements can be refunded; this invoice was settled in demo mode.' },
      { status: 400 },
    )
  }
  if (invoice.status !== 'PAID') {
    return NextResponse.json({ error: `Only PAID invoices can be refunded (current: ${invoice.status})` }, { status: 400 })
  }
  if (!invoice.onChainInvoiceId) {
    return NextResponse.json({ error: 'This invoice exists only in the database and cannot be refunded on-chain' }, { status: 400 })
  }
  if (!invoice.payerAddress) {
    return NextResponse.json({ error: 'Invoice has no recorded payer address' }, { status: 400 })
  }

  const pk = process.env.DEPLOYER_PRIVATE_KEY
  if (!pk || !pk.startsWith('0x') || pk.length < 66) {
    return NextResponse.json({ error: 'DEPLOYER_PRIVATE_KEY is not configured on the server' }, { status: 500 })
  }

  const quota = await spendQuota('merchant-refund', auth.actor.merchantId, 4, 60)
  if (quota) return quota
  let provider: ethers.JsonRpcProvider | undefined
  try {
    provider = await checkedProvider()
    const wallet = new ethers.Wallet(pk, provider)

    // The on-chain invoice can only be refunded by its merchant
    if (wallet.address.toLowerCase() !== invoice.merchant.walletAddress.toLowerCase()) {
      return NextResponse.json(
        { error: `Merchant wallet mismatch: server key ${wallet.address} != merchant ${invoice.merchant.walletAddress}` },
        { status: 400 },
      )
    }

    // SECURITY: read the invoice state from the chain — never trust the DB
    // for the refund recipient or the amounts.
    const gw = new ethers.Contract(
      gatewayAddress,
      ['function getInvoice(bytes32 invoiceId) view returns ((bytes32 id, address merchant, address token, uint256 amount, address payer, uint8 status, uint256 createdAt, uint256 expiresAt, uint256 paidAt, string orderRef, uint256 feePaid))', 'function refundDeadline(bytes32) view returns (uint256)', 'function pendingFees(address) view returns (uint256)'
],
      provider,
    )
    const chainInv = await gw.getInvoice(invoice.onChainInvoiceId)

    // status enum: 0 PENDING, 1 PAID, 2 EXPIRED, 3 REFUNDED, 4 CANCELLED
    if (Number(chainInv.status) !== 1) {
      return NextResponse.json(
        { error: `On-chain invoice is not PAID (chain status: ${Number(chainInv.status)})` },
        { status: 400 },
      )
    }
    if (!sameAddress(chainInv.merchant, wallet.address) || !sameAddress(chainInv.token, tokenAddress)) return NextResponse.json({ error: 'On-chain merchant or token mismatch.' }, { status: 409 })
    if (CONTRACT_VERSION === '3') {
      const latest = await provider.getBlock('latest')
      if (!latest || BigInt(latest.timestamp) >= await gw.refundDeadline(invoice.onChainInvoiceId)) return NextResponse.json({ error: 'Refund deadline is reached or too close.' }, { status: 409 })
    } else if (await gw.pendingFees(tokenAddress) < chainInv.feePaid) {
      return NextResponse.json({ error: 'V2 fee escrow is currently insufficient for this refund.' }, { status: 409 })
    }
    const recipient = String(chainInv.payer)
    if (recipient === ethers.ZeroAddress) {
      return NextResponse.json({ error: 'On-chain invoice has no payer recorded' }, { status: 400 })
    }

    // amounts straight from the chain (smallest units, fee already stored on-chain)
    const netSmallest = chainInv.amount - chainInv.feePaid

    const token = new ethers.Contract(
      tokenAddress,
      ['function approve(address spender, uint256 amount) returns (bool)'],
      wallet,
    )
    const refundGw = new ethers.Contract(
      gatewayAddress,
      ['function refund(bytes32 invoiceId, address to)'],
      wallet,
    )

    // 1) approve the gateway to pull the merchant's net share back
    const approveTx = await token.approve(gatewayAddress, netSmallest)
    const approveReceipt = await approveTx.wait()
    console.log('refund approve tx:', approveReceipt.hash)

    // 2) refund — pulls net from merchant, releases escrowed fee, pays the on-chain payer
    const refundTx = await refundGw.refund(invoice.onChainInvoiceId, recipient)
    const refundReceipt = await refundTx.wait()
    console.log('refund executed tx:', refundReceipt.hash, 'block:', refundReceipt.blockNumber)

    const updated = await db.invoice.update({
      where: { id },
      data: {
        status: 'REFUNDED',
        // blockNumber stays on the payment block so it keeps matching txHash
      },
      include: {
      merchant: {
        select: { id: true, name: true, businessName: true, walletAddress: true, avatarColor: true },
      },
    },
    })

    const tx = await db.transaction.create({
      data: {
        invoiceId: invoice.id,
        txHash: refundReceipt.hash,
        fromAddress: wallet.address,
        toAddress: recipient,
        amount: invoice.amount,
        token: invoice.token,
        blockNumber: refundReceipt.blockNumber,
        status: 'CONFIRMED',
        networkFee: 0,
        confirmations: 1,
        source: 'ONCHAIN',
      },
    })

    // Fire webhooks for invoice.refunded (best-effort)
    try {
      const webhooks = await db.webhook.findMany({ where: { merchantId: invoice.merchantId, isActive: true } })
      for (const w of webhooks) {
        if (w.events.includes('invoice.refunded')) {
          await db.webhookDelivery.create({
            data: {
              webhookId: w.id,
              invoiceId: invoice.id,
              event: 'invoice.refunded',
              payload: JSON.stringify({
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                amount: invoice.amount,
                token: invoice.token,
                payerAddress: recipient,
                txHash: refundReceipt.hash,
                isReal: true,
              }),
              statusCode: null,
              response: '{"simulated":true,"reason":"outbound webhooks are not dispatched in this build"}',
              success: false,
              attempts: 0,
            },
          })
        }
      }
    } catch (e) {
      console.error('webhook fire failed:', e)
    }

    return NextResponse.json({
      invoice: updated,
      transaction: tx,
      isReal: true,
      approveTxHash: approveReceipt.hash,
      refundTxHash: refundReceipt.hash,
    })
  } catch {
    return NextResponse.json({ error: 'Refund did not complete. Check the wallet receipts before retrying.' }, { status: 502 })
  } finally { provider?.destroy() }
}
