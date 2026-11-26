import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { maskEmail } from '@/lib/sanitize'
import { requireSession } from '@/lib/api-auth'

// Owner-only invoice detail. Public checkout uses its own projection.
const MERCHANT_SELECT = {
  id: true,
  name: true,
  businessName: true,
  walletAddress: true,
  avatarColor: true,
} as const

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const invoice = await db.invoice.findUnique({
    where: { id, merchantId: auth.actor.merchantId },
    include: {
      merchant: { select: MERCHANT_SELECT },
      transactions: true,
      webhookDeliveries: true,
    },
  })
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  return NextResponse.json({ invoice: { ...invoice, customerEmail: maskEmail(invoice.customerEmail), txHash: invoice.settlementSource === 'ONCHAIN' ? invoice.txHash : null }, scope: 'owner' })
}
