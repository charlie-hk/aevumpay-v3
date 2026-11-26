'use client'

import { useEffect, useState } from 'react'
import {
  Code2,
  Copy,
  CheckCircle2,
  FileText,
  Download,
  ExternalLink,
  Shield,
  Zap,
  Loader2,
  Terminal,
  Layers,
} from 'lucide-react'
import { CONTRACTS, CONTRACT_VERSION, EXPLORER_BASE, V3_DEPLOYED_ADDRESS } from '@/lib/contracts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface ContractSource {
  name: string
  content: string
  contentBase64: string
}

interface ContractData {
  sources: ContractSource[]
  readme: string
  network: string
}

const FEATURES = [
  { icon: Shield, label: 'ReentrancyGuard', desc: 'Every state-changing function is protected', color: '#00DC82' },
  { icon: Zap, label: 'Merchant settlement', desc: 'Merchant net settles immediately; fees are held in escrow', color: '#22D3EE' },
  { icon: Layers, label: 'Token whitelist', desc: 'Only approved ERC-20s accepted', color: '#8B5CF6' },
  { icon: FileText, label: 'Agent mandates', desc: 'Per-invoice and total caps, expiry, instant revoke', color: '#F59E0B' },
]

const DEPLOY_STEPS = [
  { step: '1', cmd: 'cd contracts && npm ci', desc: 'Install Hardhat + OpenZeppelin' },
  { step: '2', cmd: 'cp .env.example .env  # add testnet keys only', desc: 'Configure environment' },
  { step: '3', cmd: 'npm test', desc: 'Compile and run the 52 tests' },
  { step: '4', cmd: 'CONFIRM_V3_DEPLOY=v3-candidate npm run deploy', desc: 'Deploy to QDay testnet' },
  { step: '5', cmd: 'npm run demo:agent', desc: 'Run the agent mandate flow on-chain' },
]

export function ContractView() {
  const [data, setData] = useState<ContractData | null>(null)
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  const [decodedContent, setDecodedContent] = useState('')

  useEffect(() => {
    fetch('/api/contract')
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Decode base64 content for the active source.
  // We use base64 to avoid any text-rendering issues with characters that
  // some browsers/terminals misinterpret as ANSI escape sequences.
  useEffect(() => {
    if (!data || !data.sources[active]) {
      setDecodedContent('')
      return
    }
    try {
      const decoded = atob(data.sources[active].contentBase64)
      // Convert binary string to UTF-8
      const bytes = new Uint8Array(decoded.length)
      for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
      setDecodedContent(new TextDecoder('utf-8').decode(bytes))
    } catch {
      setDecodedContent(data.sources[active].content || '')
    }
  }, [data, active])

  function copyActive() {
    if (!decodedContent) return
    navigator.clipboard.writeText(decodedContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    toast.success('Contract source copied')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-neon" />
      </div>
    )
  }

  const source = data?.sources[active]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">Smart Contract</h1>
            <Badge className="bg-neon/10 text-neon border-neon/20 hover:bg-neon/10">Solidity 0.8.24</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Open-source invoice-based payment gateway for the QDay testnet. Testnet software; not audited for mainnet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api/contract"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" className="border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5">
              <ExternalLink className="size-4" /> View API
            </Button>
          </a>
          <a href="/download/contracts/README.md" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5">
              <FileText className="size-4" /> README
            </Button>
          </a>
        </div>
      </div>

      {/* Features grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {FEATURES.map((f) => {
          const Icon = f.icon
          return (
            <Card key={f.label} className="p-4 glass border-white/5">
              <div
                className="flex size-9 items-center justify-center rounded-lg mb-2"
                style={{ background: `${f.color}1a`, color: f.color }}
              >
                <Icon className="size-4" />
              </div>
              <div className="text-sm font-semibold">{f.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{f.desc}</div>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Source code viewer */}
        <Card className="lg:col-span-3 glass border-white/5 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
            <div className="flex items-center gap-1.5">
              {data?.sources.map((s, i) => (
                <button
                  key={s.name}
                  onClick={() => setActive(i)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                    active === i
                      ? 'bg-white/[0.06] text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.03]'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon" className="size-8" onClick={copyActive}>
              {copied ? <CheckCircle2 className="size-3.5 text-neon" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <div className="overflow-auto scroll-styled max-h-[600px] bg-[#0a0c14]">
            <pre className="p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-all">
              <code>{decodedContent}</code>
            </pre>
          </div>
        </Card>

        {/* Sidebar: deployment + ABI */}
        <div className="lg:col-span-2 space-y-4">
          {/* Deployment steps */}
          <Card className="p-5 glass border-white/5">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Terminal className="size-4 text-neon" /> Deploy in 5 steps
            </h3>
            <div className="space-y-3">
              {DEPLOY_STEPS.map((s) => (
                <div key={s.step} className="flex gap-3">
                  <div className="flex size-6 items-center justify-center rounded-full bg-neon/15 text-neon text-xs font-bold shrink-0">
                    {s.step}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[11px] bg-white/[0.03] border border-white/5 rounded px-2 py-1 break-all">
                      <span className="text-muted-foreground">$ </span>
                      <span className="text-neon">{s.cmd}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <a
              href="/download/contracts/contracts/AevumPaymentGateway.sol"
              target="_blank"
              rel="noopener noreferrer"
              download
            >
              <Button variant="outline" className="w-full mt-4 border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5">
                <Download className="size-3.5" /> Download AevumPaymentGateway.sol
              </Button>
            </a>
          </Card>

          {/* Contract addresses (placeholder) */}
          <Card className="p-5 glass border-white/5">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Layers className="size-4 text-violet" /> Deployed Addresses
            </h3>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">AevumPaymentGateway</div>
                <code className="font-mono text-xs text-neon break-all">
                  {CONTRACTS.gateway || 'Not configured (set NEXT_PUBLIC_GATEWAY_ADDRESS after deployment)'}
                </code>
                <div className="text-[10px] text-muted-foreground mt-1">Active gateway for invoices and checkout</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">V3 gateway (agent mandates)</div>
                <a
                  href={`${EXPLORER_BASE}/address/${V3_DEPLOYED_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-neon break-all hover:underline"
                >
                  {V3_DEPLOYED_ADDRESS}
                </a>
                <div className="text-[10px] text-muted-foreground mt-1">The source shown on this page is the V3 source.</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">tUSD8 token</div>
                <code className="font-mono text-xs text-neon break-all">
                  {CONTRACTS.tUSD8 || 'Not configured'}
                </code>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Network</div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="size-2 rounded-full bg-neon pulse-dot" />
                  QDay Testnet · chain ID 44005 · gateway v{CONTRACT_VERSION}
                </div>
              </div>
            </div>
            <div className="mt-4 p-3 rounded-lg bg-violet/[0.05] border border-violet/20 text-[11px] text-muted-foreground">
              Run <code className="font-mono text-violet">npm run deploy</code> in the contracts folder to deploy
              and the addresses will be saved to <code className="font-mono text-violet">deployments/qday-v3-candidate.json</code>.
            </div>
          </Card>
        </div>
      </div>

      {/* Architecture diagram */}
      <Card className="p-6 glass border-white/5">
        <h3 className="font-semibold mb-4">Payment Flow Architecture</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
          <FlowNode title="Merchant" desc="Creates invoice" color="#00DC82" />
          <FlowArrow label="createInvoice()" />
          <FlowNode title="Gateway" desc="Stores invoice on-chain" color="#8B5CF6" highlight />
          <FlowArrow label="pay()" />
          <FlowNode title="Customer" desc="Approves + pays" color="#22D3EE" />
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <FlowNode title="Event: InvoicePaid" desc="Emitted on settlement" color="#F59E0B" small />
          <FlowNode title="Webhook log entry" desc="Simulated event record" color="#00DC82" small />
          <FlowNode title="Merchant credits order" desc="Off-chain fulfillment" color="#22D3EE" small />
        </div>
      </Card>
    </div>
  )
}

function FlowNode({
  title,
  desc,
  color,
  highlight,
  small,
}: {
  title: string
  desc: string
  color: string
  highlight?: boolean
  small?: boolean
}) {
  return (
    <div
      className={`p-4 rounded-xl glass border text-center ${highlight ? 'glow-violet' : ''} ${small ? '' : ''}`}
      style={{ borderColor: `${color}30` }}
    >
      <div className={`font-semibold ${small ? 'text-xs' : 'text-sm'}`} style={{ color }}>
        {title}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{desc}</div>
    </div>
  )
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-muted-foreground">
      <div className="font-mono text-[10px]">{label}</div>
      <svg width="40" height="12" viewBox="0 0 40 12" fill="none">
        <path d="M0 6 L36 6 M30 1 L36 6 L30 11" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  )
}
