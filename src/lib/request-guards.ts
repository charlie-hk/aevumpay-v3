import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** Reject browser cross-origin state changes; allow explicit non-browser API clients. */
export function sameOriginMutation(req: NextRequest) {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    const expected = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : req.nextUrl.origin
    return new URL(origin).origin === expected
  } catch {
    return false
  }
}

/** Use a database clock and an atomic update so separate function instances share the quota. */
export async function spendQuota(scope: string, identity: string, maximum: number, windowSeconds: number) {
  const bucket = createHash('sha256').update(`${scope}:${identity}`).digest('hex')
  const result = await db.$queryRaw<{ hits: number }[]>`
    INSERT INTO "RequestBudget" ("id", "hits", "expiresAt")
    VALUES (${bucket}, 1, CURRENT_TIMESTAMP + (${windowSeconds} * interval '1 second'))
    ON CONFLICT ("id") DO UPDATE
    SET "hits" = CASE WHEN "RequestBudget"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE "RequestBudget"."hits" + 1 END,
        "expiresAt" = CASE WHEN "RequestBudget"."expiresAt" <= CURRENT_TIMESTAMP THEN EXCLUDED."expiresAt" ELSE "RequestBudget"."expiresAt" END
    WHERE "RequestBudget"."expiresAt" <= CURRENT_TIMESTAMP OR "RequestBudget"."hits" < ${maximum}
    RETURNING "hits"`
  if (result.length) return null
  return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429, headers: { 'Retry-After': String(windowSeconds) } })
}

export function rejectMutation() {
  return NextResponse.json({ error: 'Cross-origin request denied.' }, { status: 403 })
}
