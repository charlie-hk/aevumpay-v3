import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkedProvider, configuredToken, currentInvoiceGateway, exactAmount, sameAddress } from '@/lib/checkout-proof'
import { GATEWAY_ABI } from '@/lib/contracts'
import { ethers } from 'ethers'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
  if (!/^[a-z0-9]{16,40}$/.test(id)) return NextResponse.json({ error: 'Invoice not found' }, { status: 404, headers })
  const invoice = await db.invoice.findUnique({ where: { id }, select: {
    id: true, amount: true, currency: true, token: true, invoiceNumber: true, expiresAt: true, status: true,
    onChainInvoiceId: true, gatewayAddress: true, gatewayChainId: true, payAddress: true, txHash: true,
    settlementSource: true, paidAt: true, blockNumber: true, merchant: { select: { name: true, businessName: true, walletAddress: true, avatarColor: true } },
  } })
  const gatewayAddress = invoice && currentInvoiceGateway(invoice)
  if (!invoice || !gatewayAddress) return NextResponse.json({ error: 'No active on-chain checkout for this invoice.' }, { status: 404, headers })
  let provider: ethers.JsonRpcProvider | undefined
  let payeeMatched = false
  let chainStatus: string | null = null
  try {
    const token = configuredToken()
    if (!token) throw new Error('Token is not configured.')
    provider = await checkedProvider()
    const gateway = new ethers.Contract(gatewayAddress, GATEWAY_ABI, provider)
    const state = await gateway.getInvoice(invoice.onChainInvoiceId)
    payeeMatched = state.id === invoice.onChainInvoiceId && sameAddress(state.merchant, invoice.merchant.walletAddress) && sameAddress(state.merchant, invoice.payAddress) && sameAddress(state.token, token) && state.amount === exactAmount(invoice.amount) && state.expiresAt === BigInt(Math.floor(invoice.expiresAt.getTime() / 1000))
    if (payeeMatched) chainStatus = ['PENDING','PAID','EXPIRED','REFUNDED','CANCELLED'][Number(state.status)] ?? null
  } catch {
    // Temporary RPC issues fail closed for wallet payment; the customer can retry.
  } finally { provider?.destroy() }
  const verified = invoice.settlementSource === 'ONCHAIN'
  return NextResponse.json({ invoice: {
    id: invoice.id, amount: invoice.amount, currency: invoice.currency, token: invoice.token, invoiceNumber: invoice.invoiceNumber, expiresAt: invoice.expiresAt,
    status: chainStatus === 'REFUNDED' ? 'REFUNDED' : verified ? invoice.status : invoice.expiresAt < new Date() ? 'EXPIRED' : 'PENDING',
    onChainInvoiceId: invoice.onChainInvoiceId, payAddress: invoice.payAddress, gatewayAddress, merchant: invoice.merchant,
    txHash: verified ? invoice.txHash : null, paidAt: verified ? invoice.paidAt : null, blockNumber: verified ? invoice.blockNumber : null,
    payeeMatched, chainStatus, settlementSource: verified ? 'ONCHAIN' : null,
  } }, { headers })
}
