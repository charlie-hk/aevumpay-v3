import { rejectMutation, sameOriginMutation } from '@/lib/request-guards'
import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'
import { maskSecret } from '@/lib/sanitize'

/**
 * PATCH  /api/webhooks/[id]   → update webhook (url, events, isActive)
 * DELETE /api/webhooks/[id]   → delete webhook
 *
 * Both are scoped to the signed-in merchant: an id belonging to another
 * merchant is reported as 404, so the endpoint cannot be used to probe for
 * other merchants' webhook ids.
 */
async function loadOwnedWebhook(id: string, merchantId: string) {
  const webhook = await db.webhook.findUnique({ where: { id } })
  if (!webhook || webhook.merchantId !== merchantId) return null
  return webhook
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOriginMutation(req)) return rejectMutation()
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const { id } = await params
  const existing = await loadOwnedWebhook(id, auth.actor.merchantId)
  if (!existing) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const data: Record<string, unknown> = {}
  if (body.url !== undefined) {
    let parsed: URL
    try {
      parsed = new URL(String(body.url))
    } catch {
      return NextResponse.json({ error: 'url must be a valid absolute URL' }, { status: 400 })
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return NextResponse.json({ error: 'url must use http or https' }, { status: 400 })
    }
    data.url = parsed.toString()
  }
  if (body.events !== undefined) {
    data.events = Array.isArray(body.events) ? body.events.join(',') : String(body.events)
  }
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)

  const webhook = await db.webhook.update({ where: { id }, data })
  return NextResponse.json({ webhook: { ...webhook, secret: maskSecret(webhook.secret) } })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOriginMutation(req)) return rejectMutation()
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const { id } = await params
  const existing = await loadOwnedWebhook(id, auth.actor.merchantId)
  if (!existing) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

  await db.webhook.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
