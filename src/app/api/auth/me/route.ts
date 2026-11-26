import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/api-auth'

/**
 * GET /api/auth/me
 * Returns the merchant bound to the current session. This is the only way the
 * dashboard learns who it is — there is no merchant list endpoint and no
 * merchant id in local storage.
 */
export async function GET() {
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const merchant = await db.merchant.findUnique({
    where: { id: auth.actor.merchantId },
    select: {
      id: true,
      email: true,
      name: true,
      businessName: true,
      walletAddress: true,
      avatarColor: true,
    },
  })
  if (!merchant) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  return NextResponse.json({ merchant })
}
