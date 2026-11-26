'use client'

import { STATUS_META, TOKEN_META } from '@/lib/format'

export function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status] || { label: status, color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)' }
  const pad = size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${pad}`}
      style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}
    >
      <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function TokenBadge({ token, size = 'sm' }: { token: string; size?: 'sm' | 'md' }) {
  const meta = TOKEN_META[token] || { symbol: token, color: '#94A3B8', chain: '' }
  const pad = size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-medium ${pad}`}
      style={{ color: meta.color, background: `${meta.color}1a`, borderColor: `${meta.color}40` }}
    >
      <TokenIcon token={token} size={12} />
      {meta.symbol}
    </span>
  )
}

export function TokenIcon({ token, size = 16 }: { token: string; size?: number }) {
  const meta = TOKEN_META[token] || { symbol: token, color: '#94A3B8', chain: '' }
  // Simple geometric "coin" icon
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="11" fill={meta.color} opacity="0.18" />
      <circle cx="12" cy="12" r="8" stroke={meta.color} strokeWidth="1.5" fill="none" />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill={meta.color}
        fontFamily="ui-monospace, monospace"
      >
        {meta.symbol.slice(0, 1)}
      </text>
    </svg>
  )
}

/**
 * Settlement provenance badge.
 *
 * ONCHAIN rows are real, verified settlements. SIMULATED (demo) and
 * HISTORICAL_SEED (fixture) rows are explicitly labelled so they can never be
 * read as real revenue — they are excluded from every financial figure.
 */
export function SettlementSourceBadge({ source }: { source?: string | null }) {
  if (!source) {
    return <span className="text-[10px] text-muted-foreground">—</span>
  }
  const meta =
    source === 'ONCHAIN'
      ? { label: 'On-chain', color: '#00DC82', title: 'Verified on-chain settlement' }
      : source === 'SIMULATED'
        ? { label: 'Demo', color: '#A78BFA', title: 'Demo settlement — not real, excluded from totals' }
        : source === 'HISTORICAL_SEED'
          ? { label: 'Fixture', color: '#FBBF24', title: 'Seeded demo fixture — excluded from totals' }
          : { label: source, color: '#94A3B8', title: source }

  return (
    <span
      title={meta.title}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{ color: meta.color, background: `${meta.color}1a`, borderColor: `${meta.color}40` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function MerchantAvatar({
  name,
  color,
  size = 32,
}: {
  name: string
  color: string
  size?: number
}) {
  const initials = name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${color}, ${color}88)`,
        fontSize: size * 0.4,
        boxShadow: `0 0 0 1px ${color}30, 0 0 12px -2px ${color}40`,
      }}
      aria-hidden
    >
      {initials}
    </div>
  )
}
