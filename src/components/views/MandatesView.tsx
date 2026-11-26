'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserProvider, Contract, JsonRpcProvider, ZeroAddress, formatUnits, getAddress, isAddress, parseUnits } from 'ethers'
import { AlertTriangle, Bot, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldCheck, Wallet, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ERC20_ABI, EXPLORER_BASE, MANDATE_ABI, MANDATE_GATEWAY_ADDRESS, QDAY_NETWORK, CONTRACTS } from '@/lib/contracts'

const DECIMALS = 6
const TOKEN = CONTRACTS.tUSD8

interface MandateInfo {
  token: string
  merchant: string
  maxPerInvoice: bigint
  totalCap: bigint
  spent: bigint
  validUntil: number
  active: boolean
  remaining: bigint
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const fmt = (v: bigint) => Number(formatUnits(v, DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 6 })

function errText(err: unknown): string {
  const e = err as { code?: string | number; shortMessage?: string; reason?: string; message?: string }
  if (e?.code === 'ACTION_REJECTED' || e?.code === 4001) return 'You cancelled the request in your wallet.'
  return e?.shortMessage || e?.reason || e?.message || 'Unknown error'
}

/**
 * Agent mandates: a payer lets an AI agent pay invoices within on-chain limits.
 * Talks directly to the V3 gateway from the user's own wallet. It never touches
 * the merchant session, the database, or the gateway used for invoices.
 */
export function MandatesView() {
  const [account, setAccount] = useState<string | null>(null)
  const [chainOk, setChainOk] = useState(false)
  const [busy, setBusy] = useState<'grant' | 'revoke' | 'load' | null>(null)

  const [agent, setAgent] = useState('')
  const [merchant, setMerchant] = useState('')
  const [maxPer, setMaxPer] = useState('2')
  const [totalCap, setTotalCap] = useState('5')
  const [days, setDays] = useState('7')

  const [lookup, setLookup] = useState('')
  const [info, setInfo] = useState<MandateInfo | null>(null)
  const [lastTx, setLastTx] = useState<string | null>(null)

  const readProvider = useMemo(() => new JsonRpcProvider(QDAY_NETWORK.rpcUrls[0]), [])

  useEffect(() => {
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined
    if (!eth) return
    const onAccounts = (...args: unknown[]) => setAccount(((args[0] as string[]) || [])[0] ?? null)
    const onChain = (...args: unknown[]) => setChainOk(String(args[0]).toLowerCase() === QDAY_NETWORK.chainId.toLowerCase())
    eth.on?.('accountsChanged', onAccounts)
    eth.on?.('chainChanged', onChain)
    eth.request({ method: 'eth_accounts' }).then((a) => setAccount(((a as string[]) || [])[0] ?? null)).catch(() => {})
    eth.request({ method: 'eth_chainId' }).then((c) => setChainOk(String(c).toLowerCase() === QDAY_NETWORK.chainId.toLowerCase())).catch(() => {})
    return () => {
      eth.removeListener?.('accountsChanged', onAccounts)
      eth.removeListener?.('chainChanged', onChain)
    }
  }, [])

  const connect = useCallback(async () => {
    const eth = window.ethereum
    if (!eth) {
      toast.error('No wallet detected', { description: 'Install MetaMask to manage agent mandates.' })
      return
    }
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
      if (!accounts?.[0]) return
      setAccount(accounts[0])
      const chainId = (await eth.request({ method: 'eth_chainId' })) as string
      if (chainId.toLowerCase() !== QDAY_NETWORK.chainId.toLowerCase()) {
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: QDAY_NETWORK.chainId }] })
        } catch (switchErr) {
          if ((switchErr as { code?: number }).code === 4902) {
            await eth.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: QDAY_NETWORK.chainId,
                chainName: QDAY_NETWORK.chainName,
                nativeCurrency: QDAY_NETWORK.nativeCurrency,
                rpcUrls: QDAY_NETWORK.rpcUrls,
                blockExplorerUrls: QDAY_NETWORK.blockExplorerUrls,
              }],
            })
          } else {
            throw switchErr
          }
        }
      }
      setChainOk(true)
    } catch (err) {
      toast.error('Could not connect', { description: errText(err) })
    }
  }, [])

  const loadMandate = useCallback(async (payer: string, agentAddr: string) => {
    if (!isAddress(agentAddr)) {
      toast.error('Enter a valid agent address')
      return
    }
    setBusy('load')
    try {
      const gw = new Contract(MANDATE_GATEWAY_ADDRESS, MANDATE_ABI as unknown as never, readProvider)
      const m = await gw.mandates(payer, agentAddr)
      const remaining = (await gw.mandateRemaining(payer, agentAddr)) as bigint
      if (m.totalCap === BigInt(0)) {
        setInfo(null)
        toast.info('No mandate found for this agent')
        return
      }
      setInfo({
        token: m.token,
        merchant: m.merchant,
        maxPerInvoice: m.maxPerInvoice,
        totalCap: m.totalCap,
        spent: m.spent,
        validUntil: Number(m.validUntil),
        active: m.active,
        remaining,
      })
    } catch (err) {
      toast.error('Could not read the mandate', { description: errText(err) })
    } finally {
      setBusy(null)
    }
  }, [readProvider])

  const grant = useCallback(async () => {
    if (!window.ethereum || !account || !chainOk) {
      toast.error('Connect your wallet on QDay Testnet first')
      return
    }
    if (!isAddress(agent)) return void toast.error('Agent address is not valid')
    if (merchant && !isAddress(merchant)) return void toast.error('Merchant address is not valid (or leave it empty for any merchant)')
    if (getAddress(agent) === getAddress(account)) return void toast.error('The agent must be a different wallet from yours')
    let maxUnits: bigint, capUnits: bigint
    try {
      maxUnits = parseUnits(maxPer.trim(), DECIMALS)
      capUnits = parseUnits(totalCap.trim(), DECIMALS)
    } catch {
      return void toast.error('Amounts must be plain numbers with up to 6 decimals')
    }
    const nDays = Number(days)
    if (maxUnits <= BigInt(0) || capUnits <= BigInt(0)) return void toast.error('Amounts must be greater than zero')
    if (maxUnits > capUnits) return void toast.error('Per-invoice limit cannot exceed the total cap')
    if (!Number.isFinite(nDays) || nDays <= 0 || nDays > 365) return void toast.error('Validity must be between 1 and 365 days')

    setBusy('grant')
    try {
      const signer = await new BrowserProvider(window.ethereum).getSigner()
      const token = new Contract(TOKEN, ERC20_ABI as unknown as never, signer)
      const allowance = (await token.allowance(account, MANDATE_GATEWAY_ADDRESS)) as bigint
      if (allowance < capUnits) {
        toast.info('Step 1 of 2: allow the gateway to move up to the total cap', {
          description: 'This is the most the agent could ever spend for you.',
        })
        await (await token.approve(MANDATE_GATEWAY_ADDRESS, capUnits)).wait()
      }
      toast.info('Step 2 of 2: grant the mandate', { description: 'Confirm in your wallet.' })
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + Math.floor(nDays * 86400))
      const gw = new Contract(MANDATE_GATEWAY_ADDRESS, MANDATE_ABI as unknown as never, signer)
      const tx = await gw.grantMandate(getAddress(agent), TOKEN, merchant ? getAddress(merchant) : ZeroAddress, maxUnits, capUnits, validUntil)
      const receipt = await tx.wait()
      setLastTx(receipt.hash)
      toast.success('Mandate granted')
      setLookup(getAddress(agent))
      await loadMandate(account, getAddress(agent))
    } catch (err) {
      toast.error('Could not grant the mandate', { description: errText(err) })
    } finally {
      setBusy(null)
    }
  }, [account, chainOk, agent, merchant, maxPer, totalCap, days, loadMandate])

  const revoke = useCallback(async () => {
    if (!window.ethereum || !account || !chainOk || !isAddress(lookup)) return
    setBusy('revoke')
    try {
      const signer = await new BrowserProvider(window.ethereum).getSigner()
      const gw = new Contract(MANDATE_GATEWAY_ADDRESS, MANDATE_ABI as unknown as never, signer)
      const tx = await gw.revokeMandate(getAddress(lookup))
      const receipt = await tx.wait()
      setLastTx(receipt.hash)
      toast.success('Mandate revoked. The agent can no longer spend.')
      await loadMandate(account, getAddress(lookup))
    } catch (err) {
      toast.error('Could not revoke the mandate', { description: errText(err) })
    } finally {
      setBusy(null)
    }
  }, [account, chainOk, lookup, loadMandate])

  const expired = info ? info.validUntil * 1000 < Date.now() : false
  const status = !info ? null : !info.active ? 'Revoked' : expired ? 'Expired' : 'Active'

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">Agent Mandates</h1>
            <Badge className="bg-violet/10 text-violet border-violet/20 hover:bg-violet/10">V3 gateway</Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Let an AI agent pay invoices for you within limits enforced on-chain: a cap per invoice, a total cap, an
            expiry date, and optionally a single merchant. You can revoke at any time.
          </p>
        </div>
        <a href={`${EXPLORER_BASE}/address/${MANDATE_GATEWAY_ADDRESS}`} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" className="border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5">
            <ExternalLink className="size-4" /> {short(MANDATE_GATEWAY_ADDRESS)}
          </Button>
        </a>
      </div>

      {/* Wallet */}
      <Card className="p-4 glass border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Wallet className="size-4 text-neon" />
          {account ? (
            <span>
              Payer wallet: <span className="font-mono">{short(account)}</span>
              {!chainOk && <span className="text-amber-300 ml-2">wrong network</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">Connect the wallet that will fund the agent&apos;s payments.</span>
          )}
        </div>
        {(!account || !chainOk) && (
          <Button onClick={connect} className="bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5">
            {account ? <AlertTriangle className="size-4" /> : <Wallet className="size-4" />}
            {account ? 'Switch to QDay Testnet' : 'Connect wallet'}
          </Button>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Grant */}
        <Card className="p-5 glass border-white/5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <ShieldCheck className="size-4 text-neon" /> Grant a mandate
          </h3>
          <div className="space-y-1.5">
            <Label htmlFor="agent">Agent wallet address</Label>
            <Input id="agent" placeholder="0x…" value={agent} onChange={(e) => setAgent(e.target.value.trim())} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="merchant">Merchant address (optional)</Label>
            <Input id="merchant" placeholder="Empty = any registered merchant" value={merchant} onChange={(e) => setMerchant(e.target.value.trim())} className="font-mono text-xs" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="maxper">Max per invoice</Label>
              <Input id="maxper" inputMode="decimal" value={maxPer} onChange={(e) => setMaxPer(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cap">Total cap</Label>
              <Input id="cap" inputMode="decimal" value={totalCap} onChange={(e) => setTotalCap(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="days">Valid (days)</Label>
              <Input id="days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Amounts are in tUSD8. Granting needs two wallet confirmations: an allowance for the total cap, then the mandate itself.
          </p>
          <Button onClick={grant} disabled={busy !== null || !account || !chainOk} className="w-full bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5">
            {busy === 'grant' ? <><Loader2 className="size-4 animate-spin" /> Confirm in wallet…</> : <><Bot className="size-4" /> Grant mandate</>}
          </Button>
        </Card>

        {/* Inspect */}
        <Card className="p-5 glass border-white/5 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <RefreshCw className="size-4 text-cyan" /> Check or revoke a mandate
          </h3>
          <div className="space-y-1.5">
            <Label htmlFor="lookup">Agent wallet address</Label>
            <div className="flex gap-2">
              <Input id="lookup" placeholder="0x…" value={lookup} onChange={(e) => setLookup(e.target.value.trim())} className="font-mono text-xs" />
              <Button
                variant="outline"
                disabled={busy !== null || !account}
                onClick={() => account && loadMandate(account, lookup)}
                className="border-white/10 bg-white/[0.03] hover:bg-white/[0.06] shrink-0"
              >
                {busy === 'load' ? <Loader2 className="size-4 animate-spin" /> : 'Check'}
              </Button>
            </div>
          </div>

          {info && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className={`flex items-center gap-1.5 font-medium ${status === 'Active' ? 'text-neon' : 'text-rose-400'}`}>
                  {status === 'Active' ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />} {status}
                </span>
              </div>
              <Row k="Remaining to spend" v={`${fmt(info.remaining)} tUSD8`} />
              <Row k="Spent so far" v={`${fmt(info.spent)} of ${fmt(info.totalCap)} tUSD8`} />
              <Row k="Max per invoice" v={`${fmt(info.maxPerInvoice)} tUSD8`} />
              <Row k="Merchant" v={info.merchant === ZeroAddress ? 'Any registered merchant' : short(info.merchant)} />
              <Row k="Valid until" v={new Date(info.validUntil * 1000).toLocaleString()} />
              {info.active && !expired && (
                <Button onClick={revoke} disabled={busy !== null || !chainOk} variant="outline" className="w-full mt-2 border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 gap-1.5">
                  {busy === 'revoke' ? <><Loader2 className="size-4 animate-spin" /> Revoking…</> : <><XCircle className="size-4" /> Revoke now</>}
                </Button>
              )}
            </div>
          )}

          {lastTx && (
            <a href={`${EXPLORER_BASE}/tx/${lastTx}`} target="_blank" rel="noopener noreferrer" className="text-xs text-neon hover:underline inline-flex items-center gap-1">
              Last transaction on the explorer <ExternalLink className="size-3" />
            </a>
          )}
        </Card>
      </div>

      {/* How it works */}
      <Card className="p-5 glass border-white/5">
        <h3 className="font-semibold mb-3">How the agent pays</h3>
        <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal pl-5">
          <li>You grant the mandate here. Funds stay in your wallet; the gateway can only move up to the total cap you allowed.</li>
          <li>A merchant creates an invoice. The agent wallet calls <code className="font-mono text-xs text-violet">payWithMandate(invoiceId, payer)</code>.</li>
          <li>The contract checks token, merchant, per-invoice limit, total cap and expiry, then pays the merchant from your wallet.</li>
          <li>You can revoke instantly. Revocation works even when the gateway is paused. Refunds always go back to you.</li>
        </ol>
        <p className="text-[11px] text-muted-foreground mt-3">
          Try the full agent flow from the command line with <code className="font-mono text-violet">npm run demo:agent</code> in the contracts folder. Testnet only, not audited.
        </p>
      </Card>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right break-all">{v}</span>
    </div>
  )
}
