'use client'

import { useEffect, useState } from 'react'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  CheckCircle2,
  Clock,
  Percent,
  ArrowUpRight,
  Activity,
  Users,
  Code2,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useApp } from '@/store/app'
import { formatUSD, formatNumber, timeAgo, TOKEN_META } from '@/lib/format'
import { StatusBadge, TokenBadge, MerchantAvatar } from '@/components/shared/Badges'
import { toast } from 'sonner'

interface DashboardData {
  stats: {
    totalVolume: number
    totalFees: number
    avgAmount: number
    conversionRate: number
    totalInvoices: number
    paidCount: number
    pendingCount: number
    expiredCount: number
    refundedCount: number
  }
  volumeByDay: { date: string; volume: number; count: number }[]
  tokenDistribution: { tUSD8: number; USDT: number }
  demo?: { paidCount: number; totalAmount: number; note: string }
}

interface RecentInvoice {
  id: string
  invoiceNumber: string
  amount: number
  token: string
  status: string
  customerName: string | null
  createdAt: string
  paidAt: string | null
  merchant: { id: string; name: string; avatarColor: string; businessName: string | null }
}

function StatCard({
  label,
  value,
  delta,
  deltaUp,
  icon: Icon,
  color,
  sub,
}: {
  label: string
  value: string
  delta?: string
  deltaUp?: boolean
  icon: typeof DollarSign
  color: string
  sub?: string
}) {
  return (
    <Card className="relative overflow-hidden p-5 glass border-white/5">
      <div className="absolute inset-0 opacity-20" style={{ background: `radial-gradient(circle at top right, ${color}, transparent 60%)` }} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
          <span
            className="flex size-9 items-center justify-center rounded-lg"
            style={{ background: `${color}1a`, color }}
          >
            <Icon className="size-4" strokeWidth={2} />
          </span>
        </div>
        <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        {delta && (
          <div className="mt-2 flex items-center gap-1 text-xs">
            {deltaUp ? (
              <TrendingUp className="size-3.5 text-neon" />
            ) : (
              <TrendingDown className="size-3.5 text-rose-400" />
            )}
            <span className={deltaUp ? 'text-neon' : 'text-rose-400'}>{delta}</span>
            <span className="text-muted-foreground">vs last week</span>
          </div>
        )}
      </div>
    </Card>
  )
}

export function DashboardView() {
  const { activeMerchant, setView, openInvoice } = useApp()
  const [data, setData] = useState<DashboardData | null>(null)
  const [recent, setRecent] = useState<RecentInvoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        // Scope comes from the session cookie server-side.
        const [dRes, invRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/invoices?limit=8'),
        ])
        const d = await dRes.json()
        const inv = await invRes.json()
        if (cancelled) return
        setData(d)
        setRecent(inv.invoices || [])
      } catch {
        toast.error('Failed to load dashboard data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [activeMerchant])

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="h-32 shimmer rounded-xl" />
        ))}
      </div>
    )
  }

  const { stats, volumeByDay, tokenDistribution, demo } = data
  const pieData = [
    { name: 'tUSD8', value: tokenDistribution.tUSD8, color: TOKEN_META.tUSD8.color },
    { name: 'USDT', value: tokenDistribution.USDT, color: TOKEN_META.USDT.color },
  ].filter((d) => d.value > 0)

  return (
    <div className="space-y-6">
      {/* Hero banner */}
      <Card className="relative overflow-hidden p-6 lg:p-8 glass-strong border-white/5">
        <div className="absolute -top-20 -right-20 size-72 rounded-full aurora" style={{ background: 'radial-gradient(circle, #00DC82, transparent 70%)' }} />
        <div className="absolute -bottom-32 -left-20 size-80 rounded-full aurora" style={{ background: 'radial-gradient(circle, #8B5CF6, transparent 70%)', animationDelay: '4s' }} />
        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neon/10 border border-neon/20 text-neon text-xs font-medium">
              <span className="size-1.5 rounded-full bg-neon pulse-dot" />
              QDay testnet · sandbox
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
              Welcome back, <span className="text-gradient-neon">{activeMerchant?.name || 'merchant'}</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Totals below count verified on-chain settlements only.
              {stats.pendingCount > 0 && ` ${stats.pendingCount} invoice${stats.pendingCount > 1 ? 's' : ''} awaiting payment.`}
            </p>
            {demo && demo.paidCount > 0 && (
              <p className="inline-flex items-start gap-1.5 text-[11px] text-amber-300/90 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1.5">
                <span className="font-mono">{demo.paidCount}</span>
                <span>
                  demo/fixture settlement{demo.paidCount > 1 ? 's' : ''} worth{' '}
                  {formatUSD(demo.totalAmount)} are excluded from every figure above.
                </span>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setView('invoices')}
              variant="outline"
              className="border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5"
            >
              <FileText className="size-4" /> View Invoices
            </Button>
            <Button
              onClick={() => setView('contract')}
              className="bg-violet/80 hover:bg-violet text-white gap-1.5"
            >
              <Code2 className="size-4" /> View Contract
            </Button>
          </div>
        </div>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Volume"
          value={formatUSD(stats.totalVolume)}
          delta="+12.5%"
          deltaUp
          icon={DollarSign}
          color="#00DC82"
          sub={`${stats.paidCount} paid invoices`}
        />
        <StatCard
          label="Avg Invoice"
          value={formatUSD(stats.avgAmount)}
          delta="+3.2%"
          deltaUp
          icon={TrendingUp}
          color="#22D3EE"
          sub="across all tokens"
        />
        <StatCard
          label="Conversion Rate"
          value={`${stats.conversionRate}%`}
          delta="+1.4%"
          deltaUp
          icon={Percent}
          color="#8B5CF6"
          sub="paid ÷ total"
        />
        <StatCard
          label="Fees Collected"
          value={formatUSD(stats.totalFees)}
          delta="+8.7%"
          deltaUp
          icon={Activity}
          color="#F59E0B"
          sub="0.25% platform fee"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Volume chart */}
        <Card className="lg:col-span-2 p-5 glass border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Payment Volume</h3>
              <p className="text-xs text-muted-foreground">Last 14 days · settled in tUSD8 / USDT</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-neon" /> Volume
            </div>
          </div>
          <div className="h-[260px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumeByDay} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="grad-volume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00DC82" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#00DC82" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#94A3B8', fontSize: 10 }}
                  tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#94A3B8', fontSize: 10 }}
                  tickFormatter={(v) => `$${v}`}
                  axisLine={false}
                  tickLine={false}
                  width={45}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(11,13,23,0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#94A3B8' }}
                  formatter={(v: number) => [formatUSD(v), 'Volume']}
                  labelFormatter={(d) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                />
                <Area
                  type="monotone"
                  dataKey="volume"
                  stroke="#00DC82"
                  strokeWidth={2}
                  fill="url(#grad-volume)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#00DC82', stroke: '#0B0D17', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Token distribution */}
        <Card className="p-5 glass border-white/5">
          <h3 className="font-semibold mb-1">Token Distribution</h3>
          <p className="text-xs text-muted-foreground mb-4">Volume by token</p>
          <div className="h-[180px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={4}
                  stroke="none"
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'rgba(11,13,23,0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number, n: string) => [formatUSD(v), n]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2 mt-4">
            {pieData.map((d) => (
              <div key={d.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: d.color }} />
                  <span className="font-mono">{d.name}</span>
                </div>
                <span className="font-semibold tabular-nums">{formatUSD(d.value)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Status overview + recent invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 glass border-white/5">
          <h3 className="font-semibold mb-4">Invoice Status</h3>
          <div className="space-y-3">
            {[
              { label: 'Paid', count: stats.paidCount, color: '#00DC82', icon: CheckCircle2 },
              { label: 'Pending', count: stats.pendingCount, color: '#F59E0B', icon: Clock },
              { label: 'Expired', count: stats.expiredCount, color: '#94A3B8', icon: Clock },
              { label: 'Refunded', count: stats.refundedCount, color: '#8B5CF6', icon: ArrowUpRight },
            ].map((s) => {
              const pct = stats.totalInvoices ? (s.count / stats.totalInvoices) * 100 : 0
              const Icon = s.icon
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5" style={{ color: s.color }} />
                      <span className="text-muted-foreground">{s.label}</span>
                    </div>
                    <span className="font-semibold tabular-nums">{formatNumber(s.count)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: s.color }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Recent invoices */}
        <Card className="lg:col-span-2 p-5 glass border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Recent Invoices</h3>
              <p className="text-xs text-muted-foreground">Latest activity across all merchants</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setView('invoices')} className="text-neon hover:text-neon">
              View all <ArrowUpRight className="size-3.5" />
            </Button>
          </div>
          <div className="space-y-1">
            {recent.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">No invoices yet</div>
            ) : (
              recent.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => openInvoice(inv.id)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-white/[0.03] transition-colors text-left group"
                >
                  <MerchantAvatar name={inv.merchant.name} color={inv.merchant.avatarColor} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{inv.invoiceNumber}</span>
                      <TokenBadge token={inv.token} />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {inv.customerName || 'Anonymous'} · {timeAgo(inv.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">{formatUSD(inv.amount)}</div>
                    <div className="mt-0.5"><StatusBadge status={inv.status} /></div>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>
      </div>

    </div>
  )
}
