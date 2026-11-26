import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { checkedProvider, configuredToken, currentInvoiceGateway, exactAmount, sameAddress } from '@/lib/checkout-proof'
import { rejectMutation, sameOriginMutation, spendQuota } from '@/lib/request-guards'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginMutation(req)) return rejectMutation()
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (typeof body?.txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) return NextResponse.json({ error: 'A real transaction hash is required. Simulated payments are disabled.' }, { status: 400 })
  const hash = body.txHash.toLowerCase()
  const invoice = await db.invoice.findUnique({ where: { id }, select: {
    id: true, onChainInvoiceId: true, gatewayAddress: true, gatewayChainId: true, amount: true, token: true, payAddress: true,
    settlementSource: true, txHash: true, status: true, expiresAt: true,
  } })
  const gateway = invoice && currentInvoiceGateway(invoice)
  const token = configuredToken()
  if (!invoice || !gateway || !token || invoice.token !== 'tUSD8') return NextResponse.json({ error: 'No active on-chain checkout for this invoice.' }, { status: 404 })
  if (invoice.settlementSource === 'ONCHAIN' && invoice.txHash?.toLowerCase() === hash) return NextResponse.json({ ok: true, settlementSource: 'ONCHAIN' })
  if (invoice.settlementSource || !['PENDING','EXPIRED'].includes(invoice.status)) return NextResponse.json({ error: 'Invoice is not open for reconciliation.' }, { status: 409 })
  const limit = await spendQuota('receipt', id, 15, 60)
  if (limit) return limit
  let provider: ethers.JsonRpcProvider | undefined
  try {
    provider = await checkedProvider()
    const receipt = await provider.getTransactionReceipt(hash)
    if (!receipt || receipt.status !== 1 || !receipt.to || !sameAddress(receipt.to, gateway)) return NextResponse.json({ error: 'No matching successful payment receipt.' }, { status: 409 })
    const iface = new ethers.Interface(['event InvoicePaid(bytes32 indexed invoiceId, address indexed merchant, address indexed payer, address token, uint256 amount, uint256 networkFee, uint256 paidAt)'])
    const event = receipt.logs.flatMap((log) => {
      if (!sameAddress(log.address, gateway)) return []
      const parsed = iface.parseLog(log)
      return parsed?.args.invoiceId === invoice.onChainInvoiceId ? [parsed.args] : []
    })
    if (event.length !== 1) return NextResponse.json({ error: 'Receipt is not for this invoice.' }, { status: 409 })
    const paid = event[0]
    if (!sameAddress(paid.merchant, invoice.payAddress) || !sameAddress(paid.token, token) || paid.amount !== exactAmount(invoice.amount) || paid.networkFee > paid.amount || paid.paidAt * BigInt(1000) > BigInt(invoice.expiresAt.getTime())) return NextResponse.json({ error: 'Receipt does not match the invoice details.' }, { status: 409 })
    const payerAddress = ethers.getAddress(paid.payer)
    const networkFee = Number(ethers.formatUnits(paid.networkFee, 6))
    const paidAt = new Date(Number(paid.paidAt) * 1000)
    const result = await db.$transaction(async (trx) => {
      const update = await trx.invoice.updateMany({ where: { id, settlementSource: null, status: { in: ['PENDING','EXPIRED'] } }, data: { status: 'PAID', txHash: hash, payerAddress, blockNumber: receipt.blockNumber, networkFee, paidAt, settlementSource: 'ONCHAIN' } })
      if (update.count !== 1) {
        const existing = await trx.invoice.findUnique({ where: { id }, select: { txHash: true, settlementSource: true } })
        return existing?.txHash === hash && existing?.settlementSource === 'ONCHAIN'
      }
      await trx.transaction.create({ data: { invoiceId: id, txHash: hash, fromAddress: payerAddress, toAddress: invoice.payAddress, amount: invoice.amount, token: 'tUSD8', blockNumber: receipt.blockNumber, status: 'CONFIRMED', networkFee, confirmations: 1, source: 'ONCHAIN', createdAt: paidAt } })
      return true
    })
    return result ? NextResponse.json({ ok: true, settlementSource: 'ONCHAIN' }) : NextResponse.json({ error: 'Invoice already reconciled.' }, { status: 409 })
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') return NextResponse.json({ error: 'The receipt was already recorded.' }, { status: 409 })
    return NextResponse.json({ error: 'Chain verification is temporarily unavailable.' }, { status: 502 })
  } finally { provider?.destroy() }
}
