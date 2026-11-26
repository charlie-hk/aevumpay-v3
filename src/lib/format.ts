/**
 * Helpers for formatting currency, addresses, dates, etc.
 */

export function formatUSD(n: number, max = 2): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: max,
  })
}

export function formatNumber(n: number, max = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: max })
}

export function formatToken(n: number, token = 'tUSD8'): string {
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${token}`
}

export function shortAddr(addr?: string | null, head = 6, tail = 4): string {
  if (!addr) return '—'
  if (addr.length <= head + tail + 2) return addr
  return `${addr.slice(0, head + 2)}…${addr.slice(-tail)}`
}

export function shortHash(hash?: string | null): string {
  if (!hash) return '—'
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

export function timeAgo(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const diff = (Date.now() - date.getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function timeRemaining(expiresAt: string | Date): string {
  const date = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  const diff = date.getTime() - Date.now()
  if (diff <= 0) return 'Expired'
  const mins = Math.floor(diff / 60000)
  const secs = Math.floor((diff % 60000) / 1000)
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60)
    const remMins = mins % 60
    return `${hrs}h ${remMins}m`
  }
  return `${mins}m ${secs.toString().padStart(2, '0')}s`
}

export function formatDate(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const TOKEN_META: Record<string, { symbol: string; color: string; chain: string }> = {
  tUSD8: { symbol: 'tUSD8', color: '#00DC82', chain: 'QDay Testnet' },
  USDT: { symbol: 'USDT', color: '#22D3EE', chain: 'Multi-chain' },
}

export const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  PENDING: { label: 'Pending', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
  PAID: { label: 'Paid', color: '#00DC82', bg: 'rgba(0,220,130,0.12)', border: 'rgba(0,220,130,0.3)' },
  EXPIRED: { label: 'Expired', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)' },
  REFUNDED: { label: 'Refunded', color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.3)' },
  CANCELLED: { label: 'Cancelled', color: '#F43F5E', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)' },
  CONFIRMED: { label: 'Confirmed', color: '#00DC82', bg: 'rgba(0,220,130,0.12)', border: 'rgba(0,220,130,0.3)' },
  FAILED: { label: 'Failed', color: '#F43F5E', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)' },
}
