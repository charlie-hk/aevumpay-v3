import { db, assertNoLegacyRowsForV3, ACCOUNTED_SETTLEMENT } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'

/**
 * GET /api/dashboard
 *
 * Aggregated stats for the signed-in merchant only.
 *
 * Accounting rules:
 *   • Volume, fees, average amount, conversion and token distribution are
 *     computed from ONCHAIN settlements only.
 *   • Demo (SIMULATED) and fixture (HISTORICAL_SEED) rows are counted and
 *     reported separately under `demo` so nothing pretends to be real revenue.
 */
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

  const merchantId = auth.actor.merchantId

  // Expire stale pending invoices for this merchant on read.
  await db.invoice.updateMany({
    where: { merchantId, status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })

  const invoices = await db.invoice.findMany({ where: { merchantId } })
  const paid = invoices.filter((i) => i.status === 'PAID')
  const pending = invoices.filter((i) => i.status === 'PENDING')
  const expired = invoices.filter((i) => i.status === 'EXPIRED')
  const refunded = invoices.filter((i) => i.status === 'REFUNDED')

  // Only verified on-chain settlements enter the financial figures.
  const accounted = paid.filter((i) => i.settlementSource === ACCOUNTED_SETTLEMENT)
  const demoPaid = paid.filter((i) => i.settlementSource !== ACCOUNTED_SETTLEMENT)

  const totalVolume = accounted.reduce((s, i) => s + i.amount, 0)
  const totalFees = accounted.reduce((s, i) => s + (i.networkFee || 0), 0)
  const avgAmount = accounted.length ? totalVolume / accounted.length : 0
  const conversionRate = invoices.length ? (accounted.length / invoices.length) * 100 : 0

  // Volume over last 14 days (on-chain settlements only)
  const days = 14
  const now = new Date()
  const volumeByDay: { date: string; volume: number; count: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now)
    day.setDate(now.getDate() - i)
    day.setHours(0, 0, 0, 0)
    const next = new Date(day)
    next.setDate(day.getDate() + 1)
    const dayInvoices = accounted.filter((inv) => inv.paidAt && inv.paidAt >= day && inv.paidAt < next)
    volumeByDay.push({
      date: day.toISOString().slice(0, 10),
      volume: Math.round(dayInvoices.reduce((s, i) => s + i.amount, 0) * 100) / 100,
      count: dayInvoices.length,
    })
  }

  // Token distribution (on-chain settlements only)
  const tusd8 = accounted.filter((i) => i.token === 'tUSD8').reduce((s, i) => s + i.amount, 0)
  const usdt = accounted.filter((i) => i.token === 'USDT').reduce((s, i) => s + i.amount, 0)

  return NextResponse.json({
    stats: {
      totalVolume: Math.round(totalVolume * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      avgAmount: Math.round(avgAmount * 100) / 100,
      conversionRate: Math.round(conversionRate * 10) / 10,
      totalInvoices: invoices.length,
      paidCount: accounted.length,
      pendingCount: pending.length,
      expiredCount: expired.length,
      refundedCount: refunded.length,
    },
    /** Rows that are NOT real settlements — shown for context, never counted. */
    demo: {
      paidCount: demoPaid.length,
      totalAmount: Math.round(demoPaid.reduce((s, i) => s + i.amount, 0) * 100) / 100,
      note: 'Demo/fixture settlements are excluded from every figure above.',
    },
    volumeByDay,
    tokenDistribution: { tUSD8: Math.round(tusd8 * 100) / 100, USDT: Math.round(usdt * 100) / 100 },
  })
}
