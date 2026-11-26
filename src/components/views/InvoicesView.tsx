'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Plus,
  Search,
  Filter,
  Download,
  ChevronDown,
  Loader2,
  Inbox,
  ArrowUpDown,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useApp } from '@/store/app'
import {
  formatUSD,
  formatDate,
  timeAgo,
  shortAddr,
} from '@/lib/format'
import { StatusBadge, TokenBadge, MerchantAvatar } from '@/components/shared/Badges'
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
  payAddress: string
  txHash: string | null
  payerAddress: string | null
  blockNumber: number | null
  networkFee: number | null
  expiresAt: string
  paidAt: string | null
  createdAt: string
  merchant: { id: string; name: string; avatarColor: string; businessName: string | null; walletAddress: string }
  transactions: { id: string; txHash: string; blockNumber: number; confirmations: number }[]
}

export function InvoicesView() {
  const { activeMerchant, openInvoice } = useApp()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [tokenFilter, setTokenFilter] = useState('ALL')
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (tokenFilter !== 'ALL') params.set('token', tokenFilter)
      if (search) params.set('q', search)
      const res = await fetch(`/api/invoices?${params}`)
      const data = await res.json()
      setInvoices(data.invoices || [])
    } catch {
      toast.error('Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [activeMerchant, statusFilter, tokenFilter, search])

  useEffect(() => {
    const t = setTimeout(load, 250) // debounce search
    return () => clearTimeout(t)
  }, [load])

  // Listen for "open create invoice" events from TopBar
  useEffect(() => {
    const handler = () => setCreateOpen(true)
    window.addEventListener('aevumpay:create-invoice', handler)
    return () => window.removeEventListener('aevumpay:create-invoice', handler)
  }, [])

  // Summary counts
  const counts = {
    total: invoices.length,
    paid: invoices.filter((i) => i.status === 'PAID').length,
    pending: invoices.filter((i) => i.status === 'PENDING').length,
    volume: invoices.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amount, 0),
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Create, manage, and track payment requests across all merchants.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5"
            onClick={() => toast.info('CSV export — coming soon to this view; use the Transactions tab to export paid invoices.')}
          >
            <Download className="size-4" /> Export
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5"
          >
            <Plus className="size-4" strokeWidth={2.5} /> New Invoice
          </Button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 glass border-white/5">
          <div className="text-xs text-muted-foreground">Total Invoices</div>
          <div className="text-xl font-bold tabular-nums mt-1">{counts.total}</div>
        </Card>
        <Card className="p-4 glass border-white/5">
          <div className="text-xs text-muted-foreground">Paid</div>
          <div className="text-xl font-bold tabular-nums mt-1 text-neon">{counts.paid}</div>
        </Card>
        <Card className="p-4 glass border-white/5">
          <div className="text-xs text-muted-foreground">Pending</div>
          <div className="text-xl font-bold tabular-nums mt-1 text-amber-400">{counts.pending}</div>
        </Card>
        <Card className="p-4 glass border-white/5">
          <div className="text-xs text-muted-foreground">Volume (paid)</div>
          <div className="text-xl font-bold tabular-nums mt-1">{formatUSD(counts.volume)}</div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-3 glass border-white/5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice number, customer, or order ref..."
              className="pl-9 bg-white/[0.03] border-white/10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40 bg-white/[0.03] border-white/10">
              <Filter className="size-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="EXPIRED">Expired</SelectItem>
              <SelectItem value="REFUNDED">Refunded</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tokenFilter} onValueChange={setTokenFilter}>
            <SelectTrigger className="w-full sm:w-36 bg-white/[0.03] border-white/10">
              <SelectValue placeholder="Token" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All tokens</SelectItem>
              <SelectItem value="tUSD8">tUSD8</SelectItem>
              <SelectItem value="USDT">USDT</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Invoices table */}
      <Card className="glass border-white/5 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-neon" />
            <span className="text-sm">Loading invoices…</span>
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-3 text-muted-foreground">
            <Inbox className="size-10 opacity-40" />
            <div className="text-sm font-medium">No invoices found</div>
            <div className="text-xs">Try adjusting your filters, or create a new invoice.</div>
            <Button onClick={() => setCreateOpen(true)} className="mt-2 bg-neon text-black hover:bg-neon/90 gap-1.5">
              <Plus className="size-4" /> Create Invoice
            </Button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto scroll-styled">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-medium px-4 py-3">Invoice</th>
                    <th className="text-left font-medium px-4 py-3">Merchant</th>
                    <th className="text-left font-medium px-4 py-3">Customer</th>
                    <th className="text-right font-medium px-4 py-3">Amount</th>
                    <th className="text-left font-medium px-4 py-3">Token</th>
                    <th className="text-left font-medium px-4 py-3">Status</th>
                    <th className="text-left font-medium px-4 py-3">Created</th>
                    <th className="text-left font-medium px-4 py-3">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => openInvoice(inv.id)}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono font-medium">{inv.invoiceNumber}</div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[160px]">{inv.description || '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <MerchantAvatar name={inv.merchant.name} color={inv.merchant.avatarColor} size={26} />
                          <div className="text-xs">
                            <div className="font-medium">{inv.merchant.name}</div>
                            <div className="text-muted-foreground">{inv.merchant.businessName}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs">
                          <div className="font-medium">{inv.customerName || 'Anonymous'}</div>
                          <div className="text-muted-foreground truncate max-w-[140px]">{inv.customerEmail || '—'}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-semibold tabular-nums">{formatUSD(inv.amount)}</div>
                        <div className="text-[11px] text-muted-foreground">{inv.currency}</div>
                      </td>
                      <td className="px-4 py-3"><TokenBadge token={inv.token} /></td>
                      <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                      <td className="px-4 py-3">
                        <div className="text-xs">{timeAgo(inv.createdAt)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatDate(inv.createdAt).split(',')[0]}</div>
                      </td>
                      <td className="px-4 py-3">
                        {inv.txHash ? (
                          <a
                            href="#"
                            onClick={(e) => { e.stopPropagation(); toast.info(`Tx hash: ${inv.txHash}`) }}
                            className="font-mono text-[11px] text-neon hover:underline"
                          >
                            {shortAddr(inv.txHash, 4, 4)}
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-white/5">
              {invoices.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => openInvoice(inv.id)}
                  className="w-full p-4 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-medium">{inv.invoiceNumber}</span>
                    <StatusBadge status={inv.status} />
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <MerchantAvatar name={inv.merchant.name} color={inv.merchant.avatarColor} size={24} />
                    <span className="text-xs text-muted-foreground">{inv.merchant.name}</span>
                    <TokenBadge token={inv.token} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{inv.customerName || 'Anonymous'} · {timeAgo(inv.createdAt)}</span>
                    <span className="font-semibold tabular-nums">{formatUSD(inv.amount)}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

      <CreateInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false)
          load()
        }}
      />
    </div>
  )
}

function CreateInvoiceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const { activeMerchant } = useApp()
  const [amount, setAmount] = useState('')
  const [token, setToken] = useState('tUSD8')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [description, setDescription] = useState('')
  const [orderRef, setOrderRef] = useState('')
  const [expiresIn, setExpiresIn] = useState('60')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!activeMerchant) {
      toast.error('No active merchant')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(amount),
          token,
          customerName: customerName || undefined,
          customerEmail: customerEmail || undefined,
          description: description || undefined,
          orderRef: orderRef || undefined,
          expiresInMinutes: parseInt(expiresIn),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create invoice')
      }
      const { invoice } = await res.json()
      toast.success(`Invoice ${invoice.invoiceNumber} created`)
      // Reset form
      setAmount(''); setCustomerName(''); setCustomerEmail(''); setDescription(''); setOrderRef('')
      onCreated()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card/95 border-white/10 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Create New Invoice</DialogTitle>
          <DialogDescription>
            Generate a payment request. The customer will receive a unique payment link with a QR code.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount (USD)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="99.00"
                required
                className="bg-white/[0.03] border-white/10 tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token">Token</Label>
              <Select value={token} onValueChange={setToken}>
                <SelectTrigger id="token" className="bg-white/[0.03] border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tUSD8">tUSD8 (QDay testnet)</SelectItem>
                  <SelectItem value="USDT">USDT</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Customer name</Label>
              <Input
                id="name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Alex Rivera"
                className="bg-white/[0.03] border-white/10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Customer email</Label>
              <Input
                id="email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="alex@example.com"
                className="bg-white/[0.03] border-white/10"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Pro Plan — Annual Subscription"
              rows={2}
              className="bg-white/[0.03] border-white/10 resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="order">Order reference</Label>
              <Input
                id="order"
                value={orderRef}
                onChange={(e) => setOrderRef(e.target.value)}
                placeholder={`ORDER-${Date.now()}`}
                className="bg-white/[0.03] border-white/10 font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expires">Expires in (minutes)</Label>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger id="expires" className="bg-white/[0.03] border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="360">6 hours</SelectItem>
                  <SelectItem value="1440">24 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !amount}
              className="bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create Invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
