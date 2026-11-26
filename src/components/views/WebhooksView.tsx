'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Plus,
  Webhook as WebhookIcon,
  Copy,
  CheckCircle2,
  Loader2,
  Trash2,
  Power,
  Send,
  AlertCircle,
  Shield,
  Clock,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useApp } from '@/store/app'
import { formatDate, timeAgo, shortAddr } from '@/lib/format'
import { toast } from 'sonner'

interface Webhook {
  id: string
  url: string
  events: string
  secret: string
  isActive: boolean
  createdAt: string
  deliveries: WebhookDelivery[]
}

interface WebhookDelivery {
  id: string
  event: string
  payload: string
  statusCode: number | null
  response: string | null
  success: boolean
  attempts: number
  createdAt: string
}

const EVENT_OPTIONS = [
  { id: 'invoice.created', label: 'invoice.created', desc: 'New invoice issued' },
  { id: 'invoice.paid', label: 'invoice.paid', desc: 'Payment received' },
  { id: 'invoice.expired', label: 'invoice.expired', desc: 'Invoice expired unpaid' },
  { id: 'invoice.refunded', label: 'invoice.refunded', desc: 'Merchant issued refund' },
]

// The dashboard authenticates with the HttpOnly session cookie, so mutating
// calls only need to declare JSON. There is no client-side API key.
const jsonHeaders = () => ({ 'Content-Type': 'application/json' })

export function WebhooksView() {
  const { activeMerchant } = useApp()
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Scope comes from the session server-side; no merchantId needed.
      const res = await fetch('/api/webhooks')
      const data = await res.json()
      setWebhooks(data.webhooks || [])
    } catch {
      toast.error('Failed to load webhooks')
    } finally {
      setLoading(false)
    }
  }, [activeMerchant])

  useEffect(() => { load() }, [load])

  async function toggleActive(wh: Webhook) {
    try {
      const res = await fetch(`/api/webhooks/${wh.id}`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ isActive: !wh.isActive }) })
      if (!res.ok) throw new Error()
      toast.success(`Webhook ${!wh.isActive ? 'enabled' : 'disabled'}`)
      await load()
    } catch { toast.error('Could not update endpoint') }
  }

  async function deleteWebhook(wh: Webhook) {
    if (!confirm(`Delete webhook for ${wh.url}?`)) return
    try {
      const res = await fetch(`/api/webhooks/${wh.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Webhook deleted')
      await load()
    } catch { toast.error('Could not delete endpoint') }
  }

  async function testWebhook(wh: Webhook) {
    try {
      const res = await fetch('/api/webhooks/test', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ webhookId: wh.id, event: 'invoice.paid' }) })
      if (!res.ok) throw new Error()
      toast.success('Simulation recorded. No HTTP request was sent.')
      await load()
    } catch { toast.error('Could not record test event') }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
    toast.success(`${label} copied`)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
          <p className="text-sm text-muted-foreground">
            Preview notifications for invoice events.
            <span className="text-amber-300"> In this demo, deliveries are simulated — payloads are
            recorded but no real HTTP request is sent.</span>
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5">
          <Plus className="size-4" strokeWidth={2.5} /> Add Endpoint
        </Button>
      </div>

      {/* Info banner */}
      <Card className="p-4 glass border-violet/20 bg-violet/[0.03]">
        <div className="flex items-start gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-violet/15 text-violet shrink-0">
            <Shield className="size-4" />
          </div>
          <div className="flex-1 text-sm">
            <div className="font-medium">Simulation only</div>
            <p className="text-xs text-muted-foreground mt-0.5">This build does not send or sign webhook requests. Do not use these logs as proof of delivery.</p>
          </div>
        </div>
      </Card>

      {/* Endpoints */}
      {loading ? (
        <div className="p-12 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-neon" />
          <span className="text-sm">Loading webhooks…</span>
        </div>
      ) : webhooks.length === 0 ? (
        <Card className="p-12 glass border-white/5 text-center">
          <WebhookIcon className="size-10 opacity-40 mx-auto mb-3" />
          <div className="text-sm font-medium">No webhook endpoints</div>
          <div className="text-xs text-muted-foreground mt-1">Add an endpoint to view simulated event records.</div>
          <Button onClick={() => setCreateOpen(true)} className="mt-4 bg-neon text-black hover:bg-neon/90 gap-1.5">
            <Plus className="size-4" /> Add Endpoint
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {webhooks.map((wh) => (
            <Card key={wh.id} className={`p-5 glass border-white/5 ${wh.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`size-2 rounded-full ${wh.isActive ? 'bg-neon pulse-dot' : 'bg-muted-foreground'}`}
                    />
                    <span className="font-mono text-sm font-medium truncate">{wh.url}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {wh.events.split(',').map((ev) => (
                      <span
                        key={ev}
                        className="px-2 py-0.5 rounded-md bg-violet/10 border border-violet/20 text-violet text-[10px] font-mono"
                      >
                        {ev.trim()}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => testWebhook(wh)}
                    className="text-neon hover:text-neon hover:bg-neon/10 gap-1.5"
                  >
                    <Send className="size-3.5" /> Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleActive(wh)}
                    className="size-8 text-muted-foreground hover:text-foreground"
                    title={wh.isActive ? 'Disable' : 'Enable'}
                  >
                    <Power className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteWebhook(wh)}
                    className="size-8 text-muted-foreground hover:text-rose-400"
                    title="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Secret */}
              <div className="mb-4">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Signing secret</Label>
                <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
                  <span className="font-mono text-xs truncate flex-1">{wh.secret}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0"
                    onClick={() => copy(wh.secret, 'Secret')}
                  >
                    {copied === 'Secret' ? <CheckCircle2 className="size-3 text-neon" /> : <Copy className="size-3" />}
                  </Button>
                </div>
              </div>

              {/* Recent deliveries */}
              {wh.deliveries.length > 0 && (
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Recent deliveries</Label>
                  <div className="mt-2 space-y-1 max-h-48 overflow-y-auto scroll-styled">
                    {wh.deliveries.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-xs"
                      >
                        <AlertCircle className="size-3.5 text-amber-400 shrink-0" />
                        <span className="font-mono text-violet shrink-0">{d.event}</span>
                        <span className="text-muted-foreground shrink-0">Simulation / not verified as sent</span>
                        <span className="text-muted-foreground ml-auto flex items-center gap-1">
                          <Clock className="size-3" /> {timeAgo(d.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <CreateWebhookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => { setCreateOpen(false); load() }}
      />
    </div>
  )

  function CreateWebhookDialog({
    open,
    onOpenChange,
    onCreated,
  }: {
    open: boolean
    onOpenChange: (o: boolean) => void
    onCreated: () => void
  }) {
    const { activeMerchant } = useApp()
    const [url, setUrl] = useState('')
    const [events, setEvents] = useState<string[]>(['invoice.paid'])
    const [submitting, setSubmitting] = useState(false)

    async function submit(e: React.FormEvent) {
      e.preventDefault()
      if (!activeMerchant) { toast.error('No active merchant'); return }
      setSubmitting(true)
      try {
        const res = await fetch('/api/webhooks', {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({ url, events }),
        })
        if (!res.ok) throw new Error('Failed')
        toast.success('Webhook endpoint added')
        setUrl(''); setEvents(['invoice.paid'])
        onCreated()
      } catch {
        toast.error('Failed to create webhook')
      } finally {
        setSubmitting(false)
      }
    }

    function toggleEvent(ev: string) {
      setEvents((prev) => prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev])
    }

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg bg-card/95 border-white/10 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>Add Webhook Endpoint</DialogTitle>
            <DialogDescription>
              We'll send a POST request with the event payload to your URL whenever one of the selected events fires.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="url">Endpoint URL</Label>
              <Input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.yoursite.com/webhooks/aevumpay"
                required
                className="bg-white/[0.03] border-white/10 font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>Events to subscribe</Label>
              <div className="space-y-2">
                {EVENT_OPTIONS.map((ev) => (
                  <label
                    key={ev.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5 cursor-pointer hover:bg-white/[0.04] transition-colors"
                  >
                    <Switch
                      checked={events.includes(ev.id)}
                      onCheckedChange={() => toggleEvent(ev.id)}
                    />
                    <div className="flex-1">
                      <div className="font-mono text-xs font-medium">{ev.label}</div>
                      <div className="text-[11px] text-muted-foreground">{ev.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={submitting || !url || events.length === 0}
                className="bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add Endpoint
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    )
  }
}
