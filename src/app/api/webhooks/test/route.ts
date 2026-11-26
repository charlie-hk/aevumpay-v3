import { rejectMutation, sameOriginMutation } from '@/lib/request-guards'
import { db } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/api-auth'

/**
 * POST /api/webhooks/test  { webhookId, event = 'invoice.paid' }
 *
 * Records a *test* delivery for a webhook owned by the signed-in merchant.
 *
 * This build does not dispatch outbound HTTP. The delivery row is written with
 * statusCode = null, success = false and attempts = 0, and its payload is
 * explicitly marked `simulated: true`, so no record can be mistaken for a real
 * delivery that received an HTTP 200.
 */
export async function POST(req: NextRequest) {
  if (!sameOriginMutation(req)) return rejectMutation()
  const auth = await requireSession()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const webhookId = typeof body.webhookId === 'string' ? body.webhookId : ''
  const event = typeof body.event === 'string' && body.event ? body.event : 'invoice.paid'

  if (!webhookId) {
    return NextResponse.json({ error: 'webhookId is required' }, { status: 400 })
  }

  const webhook = await db.webhook.findUnique({ where: { id: webhookId } })
  // 404 (not 403) so ids of other merchants cannot be probed.
  if (!webhook || webhook.merchantId !== auth.actor.merchantId) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  }

  const payload = JSON.stringify({
    event,
    simulated: true,
    timestamp: new Date().toISOString(),
    data: {
      invoiceId: 'test-' + Math.random().toString(36).slice(2, 9),
      invoiceNumber: 'INV-TEST-001',
      amount: 99.0,
      token: 'tUSD8',
      // No txHash: a test event has no transaction.
    },
  })

  const delivery = await db.webhookDelivery.create({
    data: {
      webhookId,
      event,
      payload,
      statusCode: null,
      response: '{"simulated":true,"reason":"outbound webhooks are not dispatched in this build"}',
      success: false,
      attempts: 0,
    },
  })

  return NextResponse.json({ ok: true, simulated: true, delivery })
}
