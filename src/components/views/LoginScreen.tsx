'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2, Lock, ShieldCheck, Zap } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Merchant sign-in. Credentials are exchanged for an HttpOnly session cookie by
 * POST /api/auth/login — no key or merchant id is ever stored client-side.
 */
export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Sign-in failed')
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="fixed inset-0 bg-grid bg-grid-fade pointer-events-none opacity-40" />
      <div
        className="fixed top-0 left-1/3 size-96 rounded-full aurora pointer-events-none"
        style={{ background: 'radial-gradient(circle, #00DC82, transparent 70%)', opacity: 0.07 }}
      />

      <div className="relative w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="size-10 rounded-xl bg-gradient-to-br from-neon via-cyan to-violet flex items-center justify-center">
            <Zap className="size-5 text-black" fill="black" />
          </div>
          <div className="leading-tight">
            <div className="text-lg font-bold">
              Aevum<span className="text-gradient-neon">Pay</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Merchant portal</div>
          </div>
        </div>

        <Card className="p-6 glass border-white/10">
          <h1 className="text-base font-semibold mb-1">Sign in</h1>
          <p className="text-xs text-muted-foreground mb-5">
            Your dashboard session is issued by the server and stored in an HttpOnly cookie.
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-white/[0.03] border-white/10"
                placeholder="you@business.io"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-white/[0.03] border-white/10"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={busy}
              className="w-full bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <div className="mt-4 flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <ShieldCheck className="size-3 mt-0.5 shrink-0 text-neon" />
          <span>
            No API key or merchant id is exposed to the browser. Every read and write is scoped to
            the signed-in merchant on the server.
          </span>
        </div>
      </div>
    </div>
  )
}
