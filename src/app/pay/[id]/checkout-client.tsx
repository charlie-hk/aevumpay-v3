'use client'

/**
 * Public checkout page — /pay/<invoiceId>
 * =======================================
 *
 * The customer-facing side of AevumPay. No dashboard, no login: open the link,
 * connect a wallet, pay. State is read from the API and cross-checked against
 * the chain (gateway.getInvoice) so the status shown is the on-chain truth.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Lock,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConnectWallet, type PayResult } from '@/components/shared/ConnectWallet'
import { CONTRACTS, QDAY_NETWORK, EXPLORER_BASE } from '@/lib/contracts'
import {
  formatUSD,
  shortAddr,
  shortHash,
  formatDate,
  timeRemaining,
  STATUS_META,
} from '@/lib/format'
import { toast } from 'sonner'

interface CheckoutInvoice {
  id: string
  payeeMatched: boolean
  chainStatus: string | null
  settlementSource: string | null
  invoiceNumber: string
  amount: number
  currency: string
  token: string
  customerName: string | null
  description: string | null
  orderRef: string | null
  status: string
  onChainInvoiceId: string | null
  payAddress: string
  txHash: string | null
  payerAddress: string | null
  blockNumber: number | null
  networkFee: number | null
  expiresAt: string
  paidAt: string | null
  createdAt: string
  merchant: {
    name: string
    businessName: string | null
    walletAddress: string
    avatarColor: string
  }
}

export function CheckoutClient({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<CheckoutInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [remaining, setRemaining] = useState('')
  const chainStatus = invoice?.chainStatus

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/checkout/${invoiceId}`, { cache: 'no-store', credentials: 'omit' })
      if (!res.ok) {
        setError(res.status === 404 ? 'Invoice not found' : 'This invoice could not be loaded')
        return
      }
      const data = await res.json()
      setInvoice(data.invoice as CheckoutInvoice)
      setError(null)
    } catch {
      setError('This invoice could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    load()
  }, [load])

  // Live countdown
  useEffect(() => {
    if (!invoice) return
    const tick = () => setRemaining(timeRemaining(invoice.expiresAt))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [invoice])

  // While the invoice is open, poll the API so a payment made from another
  // device (or another tab) is reflected without a refresh.
  useEffect(() => {
    if (!invoice || invoice.status !== 'PENDING') return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [invoice, load])

  // This signal only closes the matching SDK overlay; it is never proof of settlement.
  useEffect(() => {
    if (invoice?.status !== 'PAID' || invoice.settlementSource !== 'ONCHAIN' || window.parent === window || !document.referrer) return
    let origin: string
    try { origin = new URL(document.referrer).origin } catch { return }
    window.parent.postMessage({ type: 'aevumpay:paid', invoiceId }, origin)
  }, [invoice?.status, invoice?.settlementSource, invoiceId])

  async function recordPayment(result: PayResult) {
    setPaying(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: result.txHash,
          fromAddress: result.fromAddress,
          blockNumber: result.blockNumber,
          isReal: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not record the payment')
      toast.success('Payment confirmed on-chain')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the payment')
    } finally {
      setPaying(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-neon" />
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full p-8 glass border-rose-500/20 text-center">
          <AlertTriangle className="size-10 text-rose-400 mx-auto mb-4" />
          <h1 className="text-lg font-bold mb-2">Payment link not valid</h1>
          <p className="text-sm text-muted-foreground mb-4">{error ?? 'Invoice not found'}</p>
          <p className="text-xs text-muted-foreground">
            Ask the merchant to send you a new payment link.
          </p>
        </Card>
      </div>
    )
  }

  const meta = STATUS_META[invoice.status] ?? STATUS_META.PENDING
  const isPending = invoice.status === 'PENDING'
  const expiredByTime = new Date(invoice.expiresAt).getTime() < Date.now()
  const payable = isPending && !expiredByTime && invoice.payeeMatched && chainStatus === 'PENDING'
  const amountWei = Math.round(invoice.amount * 1e6).toString()
  const tokenAddress = CONTRACTS.tUSD8

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="fixed inset-0 bg-grid bg-grid-fade pointer-events-none opacity-40" />
      <div
        className="fixed top-0 left-1/3 size-96 rounded-full aurora pointer-events-none"
        style={{ background: 'radial-gradient(circle, #00DC82, transparent 70%)', opacity: 0.05 }}
      />

      <div className="relative flex-1 w-full max-w-lg mx-auto px-4 py-10">
        {/* Brand */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-gradient-to-br from-neon via-cyan to-violet flex items-center justify-center">
              <Zap className="size-4 text-black" fill="black" />
            </div>
            <span className="font-bold">
              Aevum<span className="text-gradient-neon">Pay</span>
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Lock className="size-3" /> Secure checkout
          </span>
        </div>

        {/* Invoice summary */}
        <Card className="p-6 glass border-white/10 mb-4">
          <div className="flex items-center gap-3 mb-5">
            <div
              className="size-10 rounded-xl flex items-center justify-center font-bold text-sm"
              style={{ backgroundColor: invoice.merchant.avatarColor + '22', color: invoice.merchant.avatarColor }}
            >
              {(invoice.merchant.businessName || invoice.merchant.name).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {invoice.merchant.businessName || invoice.merchant.name}
              </div>
              <div className="text-[11px] text-muted-foreground">requests payment</div>
            </div>
          </div>

          <div className="mb-5">
            <div className="text-3xl font-bold tracking-tight">{formatUSD(invoice.amount)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {invoice.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              {invoice.token} on QDay Testnet
            </div>
          </div>

          <div className="space-y-2 text-xs border-t border-white/5 pt-4">
            <Row label="Invoice" value={invoice.invoiceNumber} mono />
            {invoice.description && <Row label="Description" value={invoice.description} />}
            {invoice.orderRef && <Row label="Order ref" value={invoice.orderRef} mono />}
            <Row
              label="Status"
              value={
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                  style={{ backgroundColor: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}
                >
                  {meta.label}
                </span>
              }
            />
            <Row
              label={payable ? 'Expires in' : 'Expiry'}
              value={
                payable ? (
                  <span className="flex items-center gap-1 font-mono">
                    <Clock className="size-3 text-amber-400" /> {remaining}
                  </span>
                ) : (
                  formatDate(invoice.expiresAt)
                )
              }
            />
            {chainStatus && (
              <Row
                label="On-chain"
                value={
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-neon pulse-dot" />
                    <span className="font-mono text-[11px]">{chainStatus}</span>
                  </span>
                }
              />
            )}
          </div>
        </Card>

        {invoice.payeeMatched ? (
          <Card className="p-4 glass border-neon/20 mb-4">
            <p className="text-sm font-semibold flex gap-2"><ShieldCheck className="size-4 text-neon" /> On-chain payee matches this invoice</p>
            <p className="text-xs font-mono break-all mt-2">{invoice.payAddress}</p>
            <p className="text-xs text-muted-foreground mt-1">This confirms the wallet address, not the merchant's legal identity.</p>
          </Card>
        ) : isPending && !expiredByTime ? <p className="text-sm text-amber-300 mb-4">Payment is unavailable until the payee and amount can be confirmed on-chain.</p> : null}
        {chainStatus === 'PAID' && invoice.settlementSource !== 'ONCHAIN' && <p className="text-sm text-amber-300 mb-4">The chain reports payment; the receipt has not yet been recorded by AevumPay.</p>}
        {/* Payment area */}
        {payable && (
          <Card className="p-6 glass border-white/10 mb-4">
            <h2 className="text-sm font-semibold mb-1">Pay with your wallet</h2>
            <p className="text-[11px] text-muted-foreground mb-4">
              Your wallet signs the payment. The merchant receives its net share and the gateway holds the fee in escrow.
            </p>

            {invoice.onChainInvoiceId ? (
              <>
                <ConnectWallet
                  invoiceId={invoice.onChainInvoiceId}
                  tokenAddress={tokenAddress}
                  amount={amountWei}
                  tokenSymbol={invoice.token}
                  tokenDecimals={6}
                  paying={paying}
                  onPayingChange={setPaying}
                  onPaid={recordPayment}
                />
                <div className="mt-3 flex items-start gap-1.5 text-[10px] text-muted-foreground">
                  <ShieldCheck className="size-3 mt-0.5 shrink-0 text-neon" />
                  <span>
                    The server verifies the receipt, the <code className="font-mono">InvoicePaid</code> event and the
                    settled amount before marking this invoice paid.
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[11px] text-muted-foreground">
                  This invoice has no on-chain id, so it cannot be paid. Ask the merchant to issue
                  a new payment link — invoices created on-chain are payable with any wallet.
                </div>
              </>
            )}
          </Card>
        )}

        {invoice.status === 'PAID' && (
          <Card className="p-6 glass border-neon/20 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="size-5 text-neon" />
              <h2 className="text-sm font-semibold">Payment complete</h2>
            </div>
            <p className="text-[11px] text-muted-foreground mb-4">
              {invoice.settlementSource === 'ONCHAIN'
                ? 'This payment receipt was verified on-chain.'
                : 'This invoice is marked paid in demo mode only — no funds moved on-chain.'}
            </p>
            {invoice.settlementSource && invoice.settlementSource !== 'ONCHAIN' && (
              <div className="mb-4 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-amber-300">
                <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                <span>Demo settlement — not a real payment.</span>
              </div>
            )}
            <div className="space-y-2 text-xs">
              {invoice.txHash && (
                <Row
                  label="Transaction"
                  value={
                    <a
                      href={`${EXPLORER_BASE}/tx/${invoice.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neon hover:underline inline-flex items-center gap-1 font-mono"
                    >
                      {shortHash(invoice.txHash)} <ExternalLink className="size-3" />
                    </a>
                  }
                />
              )}
              {invoice.payerAddress && (
                <Row label="Paid from" value={shortAddr(invoice.payerAddress)} mono />
              )}
              {invoice.blockNumber && <Row label="Block" value={invoice.blockNumber.toLocaleString()} mono />}
              {invoice.paidAt && <Row label="Paid at" value={formatDate(invoice.paidAt)} />}
            </div>
          </Card>
        )}

        {invoice.status === 'EXPIRED' && (
          <Card className="p-6 glass border-amber-500/20 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="size-5 text-amber-400" />
              <h2 className="text-sm font-semibold">This invoice has expired</h2>
            </div>
            <p className="text-[11px] text-muted-foreground">
              It expired on {formatDate(invoice.expiresAt)} and can no longer be paid. Ask the merchant to issue a
              new payment link.
            </p>
          </Card>
        )}

        {invoice.status === 'REFUNDED' && (
          <Card className="p-6 glass border-violet-500/20 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="size-5 text-violet-400" />
              <h2 className="text-sm font-semibold">This payment was refunded</h2>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The full amount, platform fee included, was returned to the payer&apos;s wallet.
            </p>
          </Card>
        )}

        {invoice.status === 'CANCELLED' && (
          <Card className="p-6 glass border-rose-500/20 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="size-5 text-rose-400" />
              <h2 className="text-sm font-semibold">This invoice was cancelled</h2>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The merchant cancelled it before payment. No funds were moved.
            </p>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center text-[10px] text-muted-foreground space-y-2 mt-6">
          <a
            href={`${EXPLORER_BASE}/address/${CONTRACTS.gateway}?tab=contract`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-neon"
          >
            <ShieldCheck className="size-3" />
            Settled by AevumPaymentGateway · {shortAddr(CONTRACTS.gateway)} · source verified
            <ArrowUpRight className="size-3" />
          </a>
          <div>
            Powered by{' '}
            <a href="/" className="text-neon hover:underline">
              AevumPay
            </a>{' '}
            · QDay Testnet · chain 44005
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-[11px] text-right' : 'text-right'}>{value}</span>
    </div>
  )
}
