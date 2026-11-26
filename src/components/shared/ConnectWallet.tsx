'use client'

/**
 * ConnectWallet — MetaMask connection button + real on-chain payment on QDay testnet
 * =============================================================================
 *
 * This component:
 * 1. Injects MetaMask and requests connection to the QDay testnet
 * 2. Auto-switches if the user is on the wrong network
 * 3. Lets the user pay an invoice with a real `pay()` call on the Gateway contract
 * 4. Returns the real transaction hash to be recorded in the database
 *
 * Dependencies:
 * - ethers v6 (added to package.json)
 * - MetaMask or any EIP-1193 compatible wallet
 */

import { useState, useEffect, useCallback } from 'react'
import { BrowserProvider, Contract, formatUnits, parseUnits } from 'ethers'
import { Wallet, Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import {
  QDAY_NETWORK,
  CONTRACTS,
  GATEWAY_ABI,
  ERC20_ABI,
  EXPLORER_BASE,
} from '@/lib/contracts'

// EIP-1193 provider type
interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, handler: (...args: unknown[]) => void) => void
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

export interface PayResult {
  txHash: string
  fromAddress: string
  blockNumber: number
}

interface ConnectWalletProps {
  /** Called when the payment succeeds */
  onPaid?: (result: PayResult) => void
  /** Invoice ID on-chain (bytes32 hex) */
  invoiceId: string
  /** ERC-20 token address */
  tokenAddress: string
  /** Amount in smallest unit (wei-like) */
  amount: string
  /** Token symbol for display */
  tokenSymbol?: string
  /** Token decimals (default 6 for tUSD8) */
  tokenDecimals?: number
  /** Whether a payment is in progress (external state) */
  paying?: boolean
  /** Set external state for loading */
  onPayingChange?: (paying: boolean) => void
}

export function ConnectWallet({
  onPaid,
  invoiceId,
  tokenAddress,
  amount,
  tokenSymbol = 'tUSD8',
  tokenDecimals = 6,
  paying: externalPaying,
  onPayingChange,
}: ConnectWalletProps) {
  const [account, setAccount] = useState<string | null>(null)
  const [chainOk, setChainOk] = useState(false)
  const [internalPaying, setInternalPaying] = useState(false)
  const paying = externalPaying ?? internalPaying

  const setPaying = (v: boolean) => {
    setInternalPaying(v)
    onPayingChange?.(v)
  }

  // Check if MetaMask is available
  const hasMetaMask = typeof window !== 'undefined' && !!window.ethereum

  // Listen for account/chain changes
  useEffect(() => {
    if (!hasMetaMask || !window.ethereum) return

    const handleAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[]
      setAccount(accounts?.[0] ?? null)
    }
    const handleChain = (...args: unknown[]) => {
      const chainId = args[0] as string
      setChainOk(chainId === QDAY_NETWORK.chainId)
    }

    window.ethereum.on?.('accountsChanged', handleAccounts)
    window.ethereum.on?.('chainChanged', handleChain)

    // Initial check
    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((accs) => {
        const accounts = accs as string[]
        if (accounts?.[0]) setAccount(accounts[0])
      })
      .catch(() => {})
    window.ethereum
      .request({ method: 'eth_chainId' })
      .then((id) => setChainOk(id === QDAY_NETWORK.chainId))
      .catch(() => {})

    return () => {
      window.ethereum?.removeListener?.('accountsChanged', handleAccounts)
      window.ethereum?.removeListener?.('chainChanged', handleChain)
    }
  }, [hasMetaMask])

  const connect = useCallback(async () => {
    if (!hasMetaMask || !window.ethereum) {
      toast.error('MetaMask not detected', {
        description: 'Install MetaMask from metamask.io to pay on-chain.',
      })
      return
    }
    try {
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[]
      const acc = accounts?.[0]
      if (!acc) return
      setAccount(acc)

      // Ensure correct chain
      const chainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string
      if (chainId !== QDAY_NETWORK.chainId) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: QDAY_NETWORK.chainId }],
          })
          setChainOk(true)
        } catch (switchErr) {
          // Chain not added yet — add it
          const err = switchErr as { code?: number }
          if (err.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: QDAY_NETWORK.chainId,
                  chainName: QDAY_NETWORK.chainName,
                  nativeCurrency: QDAY_NETWORK.nativeCurrency,
                  rpcUrls: QDAY_NETWORK.rpcUrls,
                  blockExplorerUrls: QDAY_NETWORK.blockExplorerUrls,
                },
              ],
            })
            setChainOk(true)
          } else {
            throw switchErr
          }
        }
      } else {
        setChainOk(true)
      }

      toast.success('Wallet connected', {
        description: `${acc.slice(0, 6)}…${acc.slice(-4)}`,
      })
    } catch (err) {
      toast.error('Connection rejected', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [hasMetaMask])

  /**
   * The real part — pay the invoice on-chain.
   * 1. ERC-20 approve for the invoice amount
   * 2. gateway.pay(invoiceId)
   * 3. Wait for receipt
   */
  const pay = useCallback(async () => {
    if (!window.ethereum || !account || !chainOk) {
      toast.error('Connect your wallet first')
      return
    }
    if (!invoiceId || !tokenAddress || !amount) {
      toast.error('Invoice not loaded yet')
      return
    }

    setPaying(true)
    try {
      const provider = new BrowserProvider(window.ethereum as Eip1193Provider)
      const signer = await provider.getSigner()

      // 1) Approve token spend (if existing allowance is insufficient)
      const token = new Contract(tokenAddress, ERC20_ABI as unknown as never, signer)
      const existing = (await token.allowance(account, CONTRACTS.gateway)) as bigint
      const needed = BigInt(amount)
      if (existing < needed) {
        toast.info(`Approving ${tokenSymbol} spend…`, {
          description: 'First transaction: allow the gateway to spend your tokens.',
        })
        const apprTx = await token.approve(CONTRACTS.gateway, needed)
        await apprTx.wait()
        toast.success('Approval confirmed')
      }

      // 2) Call gateway.pay(invoiceId)
      const gateway = new Contract(CONTRACTS.gateway, GATEWAY_ABI as unknown as never, signer)
      toast.info('Sending payment…', {
        description: 'Calling gateway.pay() — confirm in your wallet.',
      })
      const payTx = await gateway.pay(invoiceId)
      const receipt = await payTx.wait()

      toast.success('Payment confirmed on-chain!', {
        description: (
          <a
            href={`${EXPLORER_BASE}/tx/${receipt.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline inline-flex items-center gap-1"
          >
            View on QDay Explorer <ExternalLink className="size-3" />
          </a>
        ),
      })

      onPaid?.({
        txHash: receipt.hash,
        fromAddress: account,
        blockNumber: Number(receipt.blockNumber),
      })
    } catch (err) {
      const e = err as { code?: string; reason?: string; shortMessage?: string }
      // User rejected
      if (e.code === 'ACTION_REJECTED' || e.code === '4001') {
        toast.error('Transaction rejected', {
          description: 'You cancelled the transaction in your wallet.',
        })
      } else {
        toast.error('Payment failed', {
          description: e.shortMessage || e.reason || (err instanceof Error ? err.message : 'Unknown error'),
        })
      }
    } finally {
      setPaying(false)
    }
  }, [account, chainOk, invoiceId, tokenAddress, amount, tokenSymbol, onPaid])

  // MetaMask not installed
  if (!hasMetaMask) {
    return (
      <Button
        onClick={() => window.open('https://metamask.io/download/', '_blank')}
        variant="outline"
        className="w-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06] gap-1.5"
      >
        <Wallet className="size-4" /> Install MetaMask to Pay On-Chain
      </Button>
    )
  }

  // Not connected
  if (!account) {
    return (
      <Button
        onClick={connect}
        className="w-full bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5"
      >
        <Wallet className="size-4" /> Connect Wallet
      </Button>
    )
  }

  // Wrong network
  if (!chainOk) {
    return (
      <Button
        onClick={connect}
        variant="outline"
        className="w-full border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 gap-1.5"
      >
        <AlertTriangle className="size-4" /> Switch to QDay Testnet
      </Button>
    )
  }

  // Connected + correct chain → pay button
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-neon">
          <CheckCircle2 className="size-3.5" />
          Connected: <span className="font-mono">{account.slice(0, 6)}…{account.slice(-4)}</span>
        </span>
        <button
          onClick={connect}
          className="text-muted-foreground hover:text-foreground underline"
        >
          Change
        </button>
      </div>
      <Button
        onClick={pay}
        disabled={paying}
        className="w-full bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5"
      >
        {paying ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Confirm in wallet…
          </>
        ) : (
          <>
            <Wallet className="size-4" /> Pay {Number(formatUnits(amount, tokenDecimals))} {tokenSymbol} on-chain
          </>
        )}
      </Button>
      <p className="text-[10px] text-muted-foreground text-center">
        Two transactions: ERC-20 approve + gateway.pay()
      </p>
    </div>
  )
}
