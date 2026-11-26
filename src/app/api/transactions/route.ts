import { db, assertNoLegacyRowsForV3 } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'

/**
 * GET /api/transactions?status=&token=&q=&limit=
 *
 * Transactions belonging to the signed-in merchant's invoices only. Each row
 * carries `source` so the UI can label SIMULATED / HISTORICAL_SEED entries and
 * keep them out of any financial total.
 */
export async function GET(req: NextRequest) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const guard = await assertNoLegacyRowsForV3()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const token = searchParams.get('token')
  const q = searchParams.get('q')
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100') || 100, 1), 500)

  const where: Record<string, unknown> = {
    invoice: { merchantId: auth.actor.merchantId },
  }
  if (status && status !== 'ALL') where.status = status
  if (token && token !== 'ALL') where.token = token
  if (q) {
    where.OR = [
      { txHash: { contains: q, mode: 'insensitive' } },
      { fromAddress: { contains: q, mode: 'insensitive' } },
      { toAddress: { contains: q, mode: 'insensitive' } },
      { invoice: { invoiceNumber: { contains: q, mode: 'insensitive' } } },
    ]
  }

  const transactions = await db.transaction.findMany({
    where,
    include: {
      invoice: {
        select: { id: true, invoiceNumber: true, merchantId: true, token: true,
          merchant: { select: { id: true, name: true, businessName: true, walletAddress: true, avatarColor: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({ transactions: transactions.map((t) => t.source === 'ONCHAIN' ? t : { ...t, txHash: '', fromAddress: '', toAddress: '', blockNumber: 0, confirmations: 0, source: 'HISTORICAL_UNVERIFIED' }) })
}
