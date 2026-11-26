import { rejectMutation, sameOriginMutation } from '@/lib/request-guards'
import { NextRequest, NextResponse } from 'next/server'
import { endSession } from '@/lib/api-auth'

/** POST /api/auth/logout — clears the session cookie. */
export async function POST(req: NextRequest) {
  if (!sameOriginMutation(req)) return rejectMutation()
  await endSession()
  return NextResponse.json({ ok: true })
}
