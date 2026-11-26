'use client'

import { useCallback, useEffect, useState } from 'react'
import { useApp, type Merchant } from '@/store/app'
import { Sidebar } from '@/components/shared/Sidebar'
import { TopBar } from '@/components/shared/TopBar'
import { DashboardView } from '@/components/views/DashboardView'
import { InvoicesView } from '@/components/views/InvoicesView'
import { InvoiceDetailView } from '@/components/views/InvoiceDetailView'
import { TransactionsView } from '@/components/views/TransactionsView'
import { WebhooksView } from '@/components/views/WebhooksView'
import { ContractView } from '@/components/views/ContractView'
import { MandatesView } from '@/components/views/MandatesView'
import { SupportView, SupportChatWidget } from '@/components/views/SupportChatWidget'
import { LoginScreen } from '@/components/views/LoginScreen'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Loader2, Zap, AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Dashboard shell.
 *
 * The only identity source is GET /api/auth/me, which reads the server-side
 * session cookie. There is no merchant switcher: a session is bound to exactly
 * one merchant, and every API call is scoped to it server-side.
 */
export default function Home() {
  const { view, activeMerchant, setActiveMerchant } = useApp()

  const [checking, setChecking] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)

  const loadIdentity = useCallback(async () => {
    setChecking(true)
    setBootError(null)
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
      if (res.status === 401) {
        setActiveMerchant(null)
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not verify your session')
      }
      const data = await res.json()
      setActiveMerchant(data.merchant as Merchant)
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Could not reach the server')
    } finally {
      setChecking(false)
    }
  }, [setActiveMerchant])

  useEffect(() => {
    loadIdentity()
  }, [loadIdentity])

  // Deep link: /?invoice=<id> opens the detail view once signed in.
  useEffect(() => {
    if (!activeMerchant) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const invId = params.get('invoice')
    if (invId) {
      useApp.getState().openInvoice(invId)
      const url = new URL(window.location.href)
      url.searchParams.delete('invoice')
      window.history.replaceState({}, '', url.toString())
    }
  }, [activeMerchant])

  function openCreateInvoice() {
    useApp.getState().setView('invoices')
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('aevumpay:create-invoice'))
    }, 100)
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setActiveMerchant(null)
    useApp.getState().setView('dashboard')
  }

  if (checking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
        <div className="relative size-16 mb-6">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-neon via-cyan to-violet animate-pulse" />
          <div className="absolute inset-1 rounded-xl bg-background flex items-center justify-center">
            <Zap className="size-8 text-neon" fill="currentColor" />
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-1">
          Aevum<span className="text-gradient-neon">Pay</span>
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Invoice-based stablecoin payment gateway on the QDay testnet
        </p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-neon" />
          Verifying session…
        </div>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
        <Card className="max-w-md p-8 glass border-rose-500/20">
          <AlertTriangle className="size-10 text-rose-400 mb-4" />
          <h1 className="text-lg font-bold mb-2">Cannot reach the server</h1>
          <p className="text-sm text-muted-foreground mb-4">{bootError}</p>
          <Button onClick={loadIdentity} className="bg-neon text-black hover:bg-neon/90 gap-1.5">
            <RefreshCw className="size-4" /> Retry
          </Button>
        </Card>
      </div>
    )
  }

  if (!activeMerchant) {
    return <LoginScreen onSignedIn={loadIdentity} />
  }

  return (
    <div className="min-h-screen flex bg-background">
      <div className="fixed inset-0 bg-grid bg-grid-fade pointer-events-none opacity-50" />
      <div className="fixed top-0 left-1/4 size-96 rounded-full aurora pointer-events-none" style={{ background: 'radial-gradient(circle, #00DC82, transparent 70%)', opacity: 0.06 }} />
      <div className="fixed bottom-0 right-1/4 size-96 rounded-full aurora pointer-events-none" style={{ background: 'radial-gradient(circle, #8B5CF6, transparent 70%)', opacity: 0.06, animationDelay: '6s' }} />

      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <TopBar
          activeMerchant={activeMerchant}
          onCreateInvoice={openCreateInvoice}
          onSignOut={signOut}
        />

        <main className="flex-1 overflow-y-auto scroll-styled">
          <div className="max-w-7xl mx-auto p-4 lg:p-6">
            {view === 'dashboard' && <DashboardView />}
            {view === 'invoices' && <InvoicesView />}
            {view === 'invoice-detail' && <InvoiceDetailView />}
            {view === 'transactions' && <TransactionsView />}
            {view === 'webhooks' && <WebhooksView />}
            {view === 'mandates' && <MandatesView />}
            {view === 'contract' && <ContractView />}
            {view === 'support' && <SupportView />}
          </div>

          <footer className="mt-8 border-t border-white/5 py-6 px-4 lg:px-6">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="size-4 rounded bg-gradient-to-br from-neon via-cyan to-violet" />
                <span>AevumPay · Invoice-based USDT/tUSD8 Payment Gateway</span>
              </div>
              <div className="flex items-center gap-3">
                <span>QDay Testnet · chain 44005</span>
                <span className="size-1 rounded-full bg-muted-foreground" />
                <a
                  href="https://dorahacks.io/hackathon/qday/detail"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neon hover:underline"
                >
                  Aevum Builder Challenge
                </a>
              </div>
            </div>
          </footer>
        </main>
      </div>

      <SupportChatWidget />

      {!useApp.getState().chatOpen && (
        <button
          onClick={() => useApp.getState().setChatOpen(true)}
          className="fixed bottom-4 right-4 z-40 size-14 rounded-full bg-gradient-to-br from-neon via-cyan to-violet shadow-2xl glow-neon flex items-center justify-center hover:scale-105 transition-transform"
          aria-label="Open support chat"
        >
          <Zap className="size-6 text-black" fill="black" />
        </button>
      )}
    </div>
  )
}
