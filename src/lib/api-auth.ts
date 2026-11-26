import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Server-side merchant authentication
 * ===================================
 *
 * The dashboard is authenticated with an HttpOnly session cookie signed on the
 * server. Nothing that grants access is ever shipped to the browser:
 *
 *   - no API key in any NEXT_PUBLIC_* variable
 *   - no merchant id trusted from a query string
 *   - the session cookie carries the merchant id, HMAC-signed with
 *     SESSION_SECRET, so it cannot be forged or swapped between merchants
 *
 * Every authenticated route resolves the merchant from the cookie and scopes
 * its reads/writes to that merchant. Cross-merchant access is rejected with 403.
 */

export const SESSION_COOKIE = 'aevumpay_session'
const SESSION_TTL_SECONDS = 60 * 60 * 12 // 12h

function sessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) return null
  return secret
}

/** Thrown when a session cannot be created/verified because config is missing. */
export class SessionConfigError extends Error {
  constructor() {
    super('SESSION_SECRET is not configured (>= 32 chars). Refusing to issue or accept sessions.')
  }
}

/** A resolved dashboard identity. */
export interface SessionActor {
  merchantId: string
  email: string
  name: string
}

// ───────────────────────── Password hashing ─────────────────────────

/** scrypt hash, format: scrypt$<saltHex>$<hashHex> */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1], 'hex')
    const expected = Buffer.from(parts[2], 'hex')
    const derived = scryptSync(password, salt, expected.length)
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

// ───────────────────────── Cookie signing ─────────────────────────

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ba.length !== bb.length || ba.length === 0) return false
  return timingSafeEqual(ba, bb)
}

function encodeSession(merchantId: string, secret: string): string {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const payload = Buffer.from(JSON.stringify({ m: merchantId, exp: expires }), 'utf8').toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

function decodeSession(token: string, secret: string): { merchantId: string } | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!safeEqualHex(sign(payload, secret), signature)) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      m?: unknown
      exp?: unknown
    }
    if (typeof parsed.m !== 'string' || typeof parsed.exp !== 'number') return null
    if (parsed.exp * 1000 < Date.now()) return null
    return { merchantId: parsed.m }
  } catch {
    return null
  }
}

// ───────────────────────── Session lifecycle ─────────────────────────

/** Issue a session cookie for a merchant that just proved its credentials. */
export async function startSession(merchantId: string): Promise<void> {
  const secret = sessionSecret()
  if (!secret) throw new SessionConfigError()
  const store = await cookies()
  store.set(SESSION_COOKIE, encodeSession(merchantId, secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0, sameSite: 'lax' })
}

/**
 * Resolve the current merchant from the signed session cookie.
 * Returns null when there is no valid session. Throws SessionConfigError when
 * the server itself is misconfigured, so callers fail closed.
 */
export async function getSessionActor(): Promise<SessionActor | null> {
  const secret = sessionSecret()
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  if (!secret) throw new SessionConfigError()

  const decoded = decodeSession(token, secret)
  if (!decoded) return null

  // Re-read the merchant so a deleted account loses access immediately.
  const merchant = await db.merchant.findUnique({
    where: { id: decoded.merchantId },
    select: { id: true, email: true, name: true },
  })
  if (!merchant) return null
  return { merchantId: merchant.id, email: merchant.email, name: merchant.name }
}

// ───────────────────────── Route helpers ─────────────────────────

export type AuthResult =
  | { ok: true; actor: SessionActor }
  | { ok: false; response: NextResponse }

/** Require an authenticated merchant session for a route handler. */
export async function requireSession(): Promise<AuthResult> {
  try {
    const actor = await getSessionActor()
    if (!actor) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
      }
    }
    return { ok: true, actor }
  } catch (e) {
    if (e instanceof SessionConfigError) {
      console.error(e.message)
      return {
        ok: false,
        response: NextResponse.json({ error: 'Server authentication is not configured' }, { status: 500 }),
      }
    }
    throw e
  }
}

/**
 * Guard a merchant-scoped route: requires a session and rejects any request that
 * names a different merchant. The session is authoritative — a `merchantId` from
 * the query/body may only be omitted or equal to the session's merchant.
 */
export async function requireOwnMerchant(requestedMerchantId?: string | null): Promise<AuthResult> {
  const auth = await requireSession()
  if (!auth.ok) return auth
  if (requestedMerchantId && requestedMerchantId !== auth.actor.merchantId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden for this merchant' }, { status: 403 }),
    }
  }
  return auth
}

/**
 * Timing-safe bearer check for the demo SDK / server-to-server callers.
 * NOT used by the dashboard — the dashboard uses the session cookie.
 * Returns false when the expected value is unset (fail closed).
 */
export function checkBearer(req: NextRequest, expected: string | undefined): boolean {
  if (!expected) return false
  const header = req.headers.get('authorization') || ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  } catch {
    return false
  }
}
