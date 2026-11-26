import { NextRequest, NextResponse } from 'next/server'
import { rejectMutation, sameOriginMutation, spendQuota } from '@/lib/request-guards'
import { db } from '@/lib/db'
import { SessionConfigError, startSession, verifyPassword } from '@/lib/api-auth'

/**
 * POST /api/auth/login  { email, password }
 *
 * Server-side merchant login. Credentials are verified against a scrypt hash
 * on the merchant row; on success an HttpOnly, HMAC-signed session cookie is
 * issued. No secret ever reaches the client.
 *
 * Failures are deliberately uniform (401, same message) so the endpoint cannot
 * be used to enumerate merchant accounts. A short constant delay is applied on
 * failure to blunt online guessing.
 */
export async function POST(req: NextRequest) {
  if (!sameOriginMutation(req)) return rejectMutation()
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password || email.length > 254 || password.length > 128) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  try {
    const quota = await spendQuota('merchant-login', email, 10, 300)
    if (quota) return quota
    const merchant = await db.merchant.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    })

    const valid = merchant ? verifyPassword(password, merchant.passwordHash) : false
    if (!merchant || !valid) {
      await new Promise((r) => setTimeout(r, 350))
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    await startSession(merchant.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof SessionConfigError) {
      console.error(e.message)
      return NextResponse.json({ error: 'Server authentication is not configured' }, { status: 500 })
    }
    console.error('login failed:', e)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
