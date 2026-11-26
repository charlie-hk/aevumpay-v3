'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  ArrowLeft,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Loader2,
  Wallet,
  Hash,
  ExternalLink,
  QrCode,
  Share2,
  Zap,
  Shield,
  RefreshCw,
  Beaker,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useApp } from '@/store/app'
import { QRCode } from '@/components/shared/QRCode'
import { StatusBadge, TokenBadge, TokenIcon, MerchantAvatar } from '@/components/shared/Badges'
import { ConnectWallet, type PayResult } from '@/components/shared/ConnectWallet'
import {
  formatUSD,
  formatToken,
  shortAddr,
  shortHash,
  timeAgo,
  timeRemaining,
  formatDate,
  TOKEN_META,
} from '@/lib/format'
import { CONTRACTS, EXPLORER_BASE } from '@/lib/contracts'
import { toast } from 'sonner'

interface Invoice {
  id: string
  invoiceNumber: string
  amount: number
  currency: string
  token: string
  customerName: string | null
  customerEmail: string | null
  description: string | null
  orderRef: string | null
  status: string
  onChainInvoiceId: string | null
  gatewayAddress: string | null
  settlementSource: string | null
  payAddress: string
  payAmount: number | null
  txHash: string | null
  payerAddress: string | null
  blockNumber: number | null
  networkFee: number | null
  expiresAt: string
  paidAt: string | null
  createdAt: string
  merchant: {
    id: string
    name: string
    businessName: string | null
    walletAddress: string
    avatarColor: string
  }
  transactions: {
    id: string
    txHash: string
    fromAddress: string
    toAddress: string
    amount: number
    blockNumber: number
    confirmations: number
    status: string
    createdAt: string
  }[]
}

export function InvoiceDetailView() {
  const { activeInvoiceId, setView, openInvoice } = useApp()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [remaining, setRemaining] = useState('')

  const load = useCallback(async () => {
    if (!activeInvoiceId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/invoices/${activeInvoiceId}`)
      const data = await res.json()
      setInvoice(data.invoice)
    } catch {
      toast.error('Failed to load invoice')
    } finally {
      setLoading(false)
    }
  }, [activeInvoiceId])

  useEffect(() => {
    load()
  }, [load])

  // Live countdown
  useEffect(() => {
    if (!invoice) return
    const update = () => setRemaining(timeRemaining(invoice.expiresAt))
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [invoice])

  // Poll for payment status (simulating on-chain listener)
  useEffect(() => {
    if (!invoice || invoice.status !== 'PENDING') return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [invoice, load])


  async function handleOnChainPaid(result: PayResult) {
    if (!invoice) return
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: result.txHash,
          fromAddress: result.fromAddress,
          blockNumber: result.blockNumber,
          isReal: true,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to record payment')
      }
      toast.success('On-chain payment recorded!')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to record payment')
    }
  }

  // Server-side on-chain refund — the merchant key lives on the server,
  // so one click runs approve + gateway.refund and records the real tx hash.
  async function handleRefund() {
    if (!invoice) return
    setRefunding(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/refund`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Refund failed')
      toast.success('Refund executed — the customer received the full amount.')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Refund failed')
    } finally {
      setRefunding(false)
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
    toast.success(`${label} copied`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-neon" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="size-8 text-amber-400 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Invoice not found</p>
        <Button onClick={() => setView('invoices')} className="mt-4">Back to invoices</Button>
      </div>
    )
  }

  const isPaid = invoice.status === 'PAID'
  const isExpired = invoice.status === 'EXPIRED'
  const isPending = invoice.status === 'PENDING'
  const tokenMeta = TOKEN_META[invoice.token] || TOKEN_META.tUSD8
  const tx = invoice.transactions[0]

  // EIP-681 payment URI for the QR code
  const payUri = `ethereum:pay-${invoice.payAddress}?amount=${invoice.amount}&token=${invoice.token}&invoiceId=${invoice.invoiceNumber}`

  // Compute on-chain invoice ID for the contract pay() call.
  //
  // In production, the on-chain invoiceId is computed as
  // keccak256(merchant, orderRef, salt, chainId) — see AevumPaymentGateway.sol line 214.
  // The frontend should obtain this ID from an indexer that listens to InvoiceCreated
  // events, or call createInvoice() itself.
  //
  // For this demo, we hardcode a real invoiceId from deployments/qday.json. If the
  // current invoice does not match this ID (likely the case), the user can use the
  // "Simulate" button. This at least allows the real MetaMask flow to be tested
  // and produces a real transaction hash on the QDay explorer.
  //
  // To create a real invoice and pay it:
  //   1. Fund a merchant wallet with tUSD8
  //   2. Call createInvoice() via hardhat (script: scripts/demo-payment.js)
  //   3. Replace this constant with the returned invoiceId
  // Real on-chain invoice id — set by the server at creation time (see /api/invoices POST).
  // Legacy invoices cannot use the current gateway unless their issuing address is known.
  const onChainInvoiceId = invoice.gatewayAddress?.toLowerCase() === CONTRACTS.gateway.toLowerCase() ? invoice.onChainInvoiceId : null

  // tUSD8 amount in smallest unit (6 decimals)
  const tokenAddress = CONTRACTS.tUSD8
  // Convert the database invoice amount to smallest unit
  // (tUSD8 decimals = 6, so amount * 1_000_000)
  const amountSmallest = BigInt(Math.round(invoice.amount * 1_000_000)).toString()

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView('invoices')}
          className="text-muted-foreground hover:text-foreground gap-1.5"
        >
          <ArrowLeft className="size-4" /> Back to invoices
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          className="text-muted-foreground hover:text-foreground gap-1.5"
        >
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>

      {/* Status hero */}
      <Card className={`relative overflow-hidden p-6 lg:p-8 glass-strong border-white/5 ${isPaid ? 'glow-neon' : ''}`}>
        {isPending && (
          <>
            <div className="absolute -top-20 -right-20 size-72 rounded-full aurora" style={{ background: 'radial-gradient(circle, #F59E0B, transparent 70%)' }} />
            <div className="absolute -bottom-20 -left-20 size-72 rounded-full aurora" style={{ background: 'radial-gradient(circle, #8B5CF6, transparent 70%)', animationDelay: '4s' }} />
          </>
        )}
        {isPaid && (
          <>
            <div className="absolute -top-20 -right-20 size-72 rounded-full aurora" style={{ background: 'radial-gradient(circle, #00DC82, transparent 70%)' }} />
            <div className="absolute -bottom-20 -left-20 size-72 rounded-full aurora" style={{ background: 'radial-gradient(circle, #22D3EE, transparent 70%)', animationDelay: '4s' }} />
          </>
        )}
        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="flex size-14 items-center justify-center rounded-2xl"
              style={{
                background: isPaid ? 'rgba(0,220,130,0.15)' : isExpired ? 'rgba(148,163,184,0.15)' : 'rgba(245,158,11,0.15)',
                color: isPaid ? '#00DC82' : isExpired ? '#94A3B8' : '#F59E0B',
              }}
            >
              {isPaid ? (
                <CheckCircle2 className="size-7" />
              ) : isExpired ? (
                <AlertTriangle className="size-7" />
              ) : (
                <Clock className="size-7" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-lg font-bold">{invoice.invoiceNumber}</span>
                <StatusBadge status={invoice.status} size="md" />
              </div>
              <p className="text-sm text-muted-foreground">
                {isPaid && `Settled ${timeAgo(invoice.paidAt!)}`}
                {isPending && `Awaiting payment · expires in ${remaining}`}
                {isExpired && 'This invoice has expired'}
                {invoice.status === 'REFUNDED' && 'Refunded to original payer'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Amount Due</div>
            <div className="text-3xl font-bold tabular-nums">{formatUSD(invoice.amount)}</div>
            <div className="text-xs text-muted-foreground">
              ≈ {formatToken(invoice.amount, invoice.token)}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Left: payment panel */}
        <div className="lg:col-span-3 space-y-5">
          {isPending && (
            <Card className="p-6 glass border-white/5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    <QrCode className="size-4 text-neon" /> Pay with {invoice.token}
                  </h3>
                  <p className="text-xs text-muted-foreground">Scan with any EIP-681 compatible wallet</p>
                </div>
                <TokenBadge token={invoice.token} size="md" />
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* QR */}
                <div className="relative p-3 rounded-2xl bg-white shrink-0">
                  <QRCode value={payUri} size={200} fg="#0B0D17" bg="#ffffff" />
                  {/* Token badge overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div
                      className="size-10 rounded-full flex items-center justify-center border-4 border-white"
                      style={{ background: tokenMeta.color }}
                    >
                      <span className="text-xs font-bold text-black">{tokenMeta.symbol[0]}</span>
                    </div>
                  </div>
                </div>

                <div className="flex-1 w-full space-y-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Send to address</div>
                    <button
                      onClick={() => copy(invoice.payAddress, 'Address')}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-colors text-left"
                    >
                      <span className="font-mono text-xs break-all">{invoice.payAddress}</span>
                      {copied === 'Address' ? (
                        <CheckCircle2 className="size-4 text-neon shrink-0" />
                      ) : (
                        <Copy className="size-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Amount</div>
                      <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5 font-mono text-sm font-semibold tabular-nums">
                        {invoice.amount} {invoice.token}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Network</div>
                      <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-sm">
                        <div className="flex items-center gap-1.5">
                          <span className="size-2 rounded-full bg-neon pulse-dot" />
                          QDay Testnet
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Gas fee (est.)</div>
                    <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-sm">
                      ~0.0000 QDAY <span className="text-muted-foreground">(free on testnet)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* REAL ON-CHAIN PAYMENT (NEW) */}
              <div className="mt-5 p-4 rounded-xl bg-neon/[0.05] border border-neon/30">
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-neon/15 text-neon shrink-0">
                    <Wallet className="size-4" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm flex items-center gap-2">
                      Pay on-chain
                      <span className="px-1.5 py-0.5 rounded bg-neon/15 text-neon text-[9px] font-mono uppercase">Real tx</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Connect MetaMask, approve the tUSD8 spend, and call{' '}
                      <code className="px-1 py-0.5 rounded bg-white/5 font-mono text-[10px]">gateway.pay(invoiceId)</code>{' '}
                      on the AevumPaymentGateway contract. Two transactions: ERC-20 approve + pay.
                    </p>
                  </div>
                </div>
                {onChainInvoiceId ? (
                  <ConnectWallet
                    invoiceId={onChainInvoiceId}
                    tokenAddress={tokenAddress}
                    amount={amountSmallest}
                    tokenSymbol={invoice.token}
                    tokenDecimals={6}
                    onPaid={handleOnChainPaid}
                  />
                ) : (
                  <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                    This invoice exists only in the database (created before the on-chain
                    integration), so it cannot be paid with a wallet. Create a new invoice —
                    new ones are created on-chain automatically.
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="size-3.5 text-neon" />
                The merchant receives its net share; the gateway holds the fee in escrow.
              </div>
            </Card>
          )}

          {isPaid && invoice.onChainInvoiceId && invoice.gatewayAddress && invoice.settlementSource === 'ONCHAIN' && (
            <Card className="p-6 glass border-white/5">
              <div className="flex items-start gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 shrink-0">
                  <RefreshCw className="size-4" />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">Refund this invoice</div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Returns the full amount to the original payer ({shortAddr(invoice.payerAddress || '')}) —
                    the merchant's net share is pulled back and the escrowed fee is released, so the customer
                    is made whole. Two on-chain transactions (approve + refund).
                  </p>
                </div>
                <Button
                  onClick={handleRefund}
                  disabled={refunding}
                  variant="outline"
                  className="border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 gap-1.5 shrink-0"
                >
                  {refunding ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {refunding ? 'Refunding…' : 'Refund'}
                </Button>
              </div>
            </Card>
          )}

          {/* Payment confirmation */}
          {isPaid && tx && invoice.settlementSource === 'ONCHAIN' && (
            <Card className="p-6 glass border-white/5">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <CheckCircle2 className="size-4 text-neon" /> Payment Confirmation
              </h3>
              <div className="space-y-3">
                <DataRow label="Transaction hash" mono>
                  <a
                    href={`${EXPLORER_BASE}/tx/${tx.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-neon hover:underline flex items-center gap-1.5"
                  >
                    {tx.txHash}
                    <ExternalLink className="size-3" />
                  </a>
                </DataRow>
                <DataRow label="From (payer)" mono>
                  <a
                    href={`${EXPLORER_BASE}/address/${tx.fromAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-neon hover:underline flex items-center gap-1.5"
                  >
                    {shortAddr(tx.fromAddress, 6, 6)}
                    <ExternalLink className="size-3" />
                  </a>
                </DataRow>
                <DataRow label="To (merchant)" mono>
                  <a
                    href={`${EXPLORER_BASE}/address/${tx.toAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-neon hover:underline flex items-center gap-1.5"
                  >
                    {shortAddr(tx.toAddress, 6, 6)}
                    <ExternalLink className="size-3" />
                  </a>
                </DataRow>
                <DataRow label="Block number">
                  <a
                    href={`${EXPLORER_BASE}/block/${tx.blockNumber}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-neon hover:underline flex items-center gap-1.5"
                  >
                    #{tx.blockNumber.toLocaleString()}
                    <ExternalLink className="size-3" />
                  </a>
                </DataRow>
                <DataRow label="Confirmations">
                  <span className="font-mono text-xs tabular-nums">{tx.confirmations} blocks</span>
                </DataRow>
                <DataRow label="Network fee">
                  <span className="text-xs">{formatUSD(invoice.networkFee || 0)} (0.25%)</span>
                </DataRow>
                <DataRow label="Settled at">
                  <span className="text-xs">{formatDate(invoice.paidAt!)}</span>
                </DataRow>
              </div>
              <a
                href={`${EXPLORER_BASE}/tx/${tx.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="outline"
                  className="mt-4 w-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5"
                >
                  <ExternalLink className="size-3.5" /> View on QDay Explorer
                </Button>
              </a>
            </Card>
          )}

          {/* Invoice details */}
          <Card className="p-6 glass border-white/5">
            <h3 className="font-semibold mb-4">Invoice Details</h3>
            <div className="space-y-3">
              <DataRow label="Description">
                <span className="text-sm">{invoice.description || '—'}</span>
              </DataRow>
              <DataRow label="Order reference" mono>
                <span className="font-mono text-xs">{invoice.orderRef || '—'}</span>
              </DataRow>
              <DataRow label="Customer">
                <div className="text-sm">
                  <div>{invoice.customerName || 'Anonymous'}</div>
                  {invoice.customerEmail && (
                    <div className="text-xs text-muted-foreground">{invoice.customerEmail}</div>
                  )}
                </div>
              </DataRow>
              <DataRow label="Created">
                <span className="text-xs">{formatDate(invoice.createdAt)}</span>
              </DataRow>
              <DataRow label="Expires">
                <span className="text-xs">{formatDate(invoice.expiresAt)}</span>
              </DataRow>
            </div>
          </Card>
        </div>

        {/* Right: merchant + meta */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-6 glass border-white/5">
            <h3 className="font-semibold mb-4">Merchant</h3>
            <div className="flex items-center gap-3 mb-4">
              <MerchantAvatar name={invoice.merchant.name} color={invoice.merchant.avatarColor} size={48} />
              <div>
                <div className="font-semibold">{invoice.merchant.name}</div>
                <div className="text-xs text-muted-foreground">{invoice.merchant.businessName}</div>
              </div>
            </div>
            <div className="space-y-3">
              <DataRow label="Wallet" mono>
                <a
                  href={`${EXPLORER_BASE}/address/${invoice.merchant.walletAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-neon hover:underline flex items-center gap-1.5"
                >
                  {shortAddr(invoice.merchant.walletAddress, 6, 6)}
                  <ExternalLink className="size-3" />
                </a>
              </DataRow>
              {/* KYC badge: kept, but flagged as a demo claim */}
              <DataRow label="Verified">
                <span className="text-xs flex items-center gap-1 text-neon">
                  <Shield className="size-3" /> Demo KYC badge
                </span>
              </DataRow>
            </div>
          </Card>

          <Card className="p-6 glass border-white/5">
            <h3 className="font-semibold mb-4">Share Invoice</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Send this payment link to your customer. They can pay from any web3 wallet.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
                <Hash className="size-3.5 text-muted-foreground shrink-0" />
                <span className="font-mono text-xs truncate flex-1">
                  {typeof window !== 'undefined' ? `${window.location.origin}/pay/${invoice.id}` : `/pay/${invoice.id}`}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => {
                    const url = `${window.location.origin}/pay/${invoice.id}`
                    navigator.clipboard.writeText(url)
                    toast.success('Checkout link copied')
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <Button
                variant="outline"
                className="w-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5"
                onClick={() => window.open(`/pay/${invoice.id}`, '_blank')}
              >
                <Share2 className="size-3.5" /> Open customer checkout
              </Button>
            </div>
          </Card>

          {/* Quick action: open another invoice */}
          <Card className="p-6 glass border-white/5">
            <h3 className="font-semibold mb-3">Need help?</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Questions about this invoice? Our support team responds in seconds.
            </p>
            <Button
              variant="outline"
              className="w-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5"
              onClick={() => useApp.getState().setChatOpen(true)}
            >
              <Wallet className="size-3.5" /> Open support chat
            </Button>
          </Card>
        </div>
      </div>
    </div>
  )
}

function DataRow({
  label,
  children,
  mono,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">{label}</span>
      <div className="text-right min-w-0 flex-1">{children}</div>
    </div>
  )
}
