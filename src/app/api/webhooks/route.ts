import { rejectMutation, sameOriginMutation } from '@/lib/request-guards'
import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { maskSecret } from '@/lib/sanitize'

/**
 * GET  /api/webhooks   → webhooks for the signed-in merchant
 * POST /api/webhooks   → create a webhook for the signed-in merchant
 *
 * Signing secrets are never returned in full by the API.
 */
export async function GET(req: NextRequest) {
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const requestedMerchantId = searchParams.get('merchantId')
  if (requestedMerchantId && requestedMerchantId !== auth.actor.merchantId) {
    return NextResponse.json({ error: 'Forbidden for this merchant' }, { status: 403 })
  }

  const webhooks = await db.webhook.findMany({
    where: { merchantId: auth.actor.merchantId },
    include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 20 } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    webhooks: webhooks.map((wh) => ({ ...wh, secret: maskSecret(wh.secret) })),
  })
}

export async function POST(req: NextRequest) {
  if (!sameOriginMutation(req)) return rejectMutation()
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { merchantId: bodyMerchantId, url, events, isActive = true } = body

  if (typeof bodyMerchantId === 'string' && bodyMerchantId && bodyMerchantId !== auth.actor.merchantId) {
    return NextResponse.json({ error: 'Forbidden for this merchant' }, { status: 403 })
  }
  if (typeof url !== 'string' || !url || !events) {
    return NextResponse.json({ error: 'url and events are required' }, { status: 400 })
  }
  // Only http(s) endpoints; reject javascript:/data: and other schemes.
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: 'url must be a valid absolute URL' }, { status: 400 })
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return NextResponse.json({ error: 'url must use http or https' }, { status: 400 })
  }

  const webhook = await db.webhook.create({
    data: {
      merchantId: auth.actor.merchantId,
      url,
      events: Array.isArray(events) ? events.join(',') : String(events),
      isActive: isActive !== false,
    },
  })

  return NextResponse.json({ webhook: { ...webhook, secret: maskSecret(webhook.secret) } })
}
