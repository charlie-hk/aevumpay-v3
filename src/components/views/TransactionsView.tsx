'use client'

import { EXPLORER_BASE } from '@/lib/contracts'

import { useEffect, useState, useCallback } from 'react'
import {
  Search,
  Filter,
  Download,
  Loader2,
  Inbox,
  ExternalLink,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useApp } from '@/store/app'
import { formatUSD, formatToken, shortAddr, shortHash, timeAgo, formatDate, TOKEN_META } from '@/lib/format'
import { StatusBadge, TokenBadge, MerchantAvatar, SettlementSourceBadge } from '@/components/shared/Badges'
import { toast } from 'sonner'

interface Txn {
  id: string
  txHash: string
  fromAddress: string
  toAddress: string
  amount: number
  token: string
  blockNumber: number
  status: string
  networkFee: number
  confirmations: number
  /** ONCHAIN | SIMULATED | HISTORICAL_SEED — only ONCHAIN is real settlement. */
  source?: string | null
  createdAt: string
  invoice: {
    id: string
    invoiceNumber: string
    merchant: { id: string; name: string; avatarColor: string; businessName: string | null; walletAddress?: string }
  }
}

export function TransactionsView() {
  const { activeMerchant, openInvoice } = useApp()
  const [txns, setTxns] = useState<Txn[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [tokenFilter, setTokenFilter] = useState('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (tokenFilter !== 'ALL') params.set('token', tokenFilter)
      if (search) params.set('q', search)
      const res = await fetch(`/api/transactions?${params}`)
      const data = await res.json()
      setTxns(data.transactions || [])
    } catch {
      toast.error('Failed to load transactions')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, tokenFilter, search])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  // Filter by merchant on the client as a UI reminder; API also scopes it
  const filtered = activeMerchant
    ? txns.filter((t) => t.invoice.merchant.id === activeMerchant.id)
    : txns

  // Only verified on-chain settlements count toward the totals. Demo and
  // fixture rows are listed but never added to any financial figure.
  const accounted = filtered.filter((t) => t.source === 'ONCHAIN')
  const totalVolume = accounted.reduce((s, t) => s + t.amount, 0)
  const totalFees = accounted.reduce((s, t) => s + t.networkFee, 0)

  function exportCSV() {
    const rows = [
      ['Tx Hash', 'Invoice', 'Merchant', 'From', 'To', 'Amount', 'Token', 'Block', 'Confirmations', 'Status', 'Fee (USD)', 'Settlement Source', 'Created At'],
      ...filtered.map((t) => [
        t.txHash,
        t.invoice.invoiceNumber,
        t.invoice.merchant.name,
        t.fromAddress,
        t.toAddress,
        t.amount.toString(),
        t.token,
        t.blockNumber.toString(),
        t.confirmations.toString(),
        t.status,
        (t.networkFee || 0).toString(),
        t.source ?? 'UNKNOWN',
        t.createdAt,
      ]),
    ]
    const csv = rows
      .map((r) => r.map((c) => `"${(c || '').toString().replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aevumpay-transactions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${filtered.length} transactions`)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            On-chain payment history with full transaction details.
          </p>
        </div>
        <Button
          onClick={exportCSV}
          disabled={filtered.length === 0}
          className="bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5"
        >
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 glass border-white/5">
          <div className="text-xs text-muted-foreground">Total Transactions</div>
          <div className="text-xl font-bold tabular-nums mt-1">{filtered.length}</div>
        </Card>
        <Card className="p-4 glass border-white/5">
          <div className="text-xs text-muted-foreground">Volume</div>
          <div className="text-xl font-bold tabular-nums mt-1 text-neon">{formatUSD(totalVolume)}</div>
        </Card>
        <Card className="p-4 glass border-white/5">
          <div className="text-xs text-muted-foreground">Fees Collected</div>
          <div className="text-xl font-bold tabular-nums mt-1 text-amber-400">{formatUSD(totalFees)}</div>
        </Card>
        <Card className="p-4 glass border-white/5">
          <div className="text-xs text-muted-foreground">Avg Tx Value</div>
          <div className="text-xl font-bold tabular-nums mt-1">
            {accounted.length ? formatUSD(totalVolume / accounted.length) : '—'}
          </div>
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
              placeholder="Search tx hash, address, or invoice number..."
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
              <SelectItem value="CONFIRMED">Confirmed</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
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

      {/* Table */}
      <Card className="glass border-white/5 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-neon" />
            <span className="text-sm">Loading transactions…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-3 text-muted-foreground">
            <Inbox className="size-10 opacity-40" />
            <div className="text-sm font-medium">No transactions found</div>
            <div className="text-xs">Try adjusting your filters.</div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto scroll-styled">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-medium px-4 py-3">Tx Hash</th>
                    <th className="text-left font-medium px-4 py-3">Invoice</th>
                    <th className="text-left font-medium px-4 py-3">Direction</th>
                    <th className="text-right font-medium px-4 py-3">Amount</th>
                    <th className="text-left font-medium px-4 py-3">Token</th>
                    <th className="text-left font-medium px-4 py-3">Block</th>
                    <th className="text-left font-medium px-4 py-3">Status</th>
                      <th className="px-4 py-2">Source</th>
                    <th className="text-left font-medium px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => openInvoice(t.invoice.id)}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {t.source === 'ONCHAIN' && t.txHash ? <a href={`${EXPLORER_BASE}/tx/${t.txHash}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-neon hover:underline flex gap-1">
                            {shortHash(t.txHash)} <ExternalLink className="size-3" />
                          </a> : <span className="text-muted-foreground text-xs">Unverified</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <MerchantAvatar name={t.invoice.merchant.name} color={t.invoice.merchant.avatarColor} size={24} />
                          <div className="text-xs">
                            <div className="font-mono font-medium">{t.invoice.invoiceNumber}</div>
                            <div className="text-muted-foreground">{t.invoice.merchant.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs">
                          {t.fromAddress.toLowerCase() === t.invoice.merchant.walletAddress?.toLowerCase() ? (
                            <ArrowUpFromLine className="size-3 text-rose-400" />
                          ) : (
                            <ArrowDownToLine className="size-3 text-neon" />
                          )}
                          <span className="font-mono text-muted-foreground">{shortAddr(t.fromAddress, 4, 4)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-semibold tabular-nums">{formatToken(t.amount, t.token)}</div>
                        <div className="text-[11px] text-muted-foreground">{formatUSD(t.amount)}</div>
                      </td>
                      <td className="px-4 py-3"><TokenBadge token={t.token} /></td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs tabular-nums">#{t.blockNumber.toLocaleString()}</span>
                        <div className="text-[10px] text-muted-foreground">{t.confirmations} conf</div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                      <td className="px-4 py-3"><SettlementSourceBadge source={t.source} /></td>
                      <td className="px-4 py-3">
                        <div className="text-xs">{timeAgo(t.createdAt)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatDate(t.createdAt).split(',')[0]}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-white/5">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openInvoice(t.invoice.id)}
                  className="w-full p-4 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="font-mono text-xs text-neon truncate">{t.source === 'ONCHAIN' && t.txHash ? shortHash(t.txHash) : 'Unverified'}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <SettlementSourceBadge source={t.source} />
                      <StatusBadge status={t.status} />
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <MerchantAvatar name={t.invoice.merchant.name} color={t.invoice.merchant.avatarColor} size={22} />
                    <span className="text-xs">{t.invoice.merchant.name}</span>
                    <TokenBadge token={t.token} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Block #{t.blockNumber.toLocaleString()}</span>
                    <span className="font-semibold tabular-nums">{formatToken(t.amount, t.token)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">{timeAgo(t.createdAt)}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
