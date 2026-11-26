import { ethers } from 'ethers'
import { activeGatewayAddress, CONTRACTS, QDAY_NETWORK } from '@/lib/contracts'

export function currentInvoiceGateway(invoice: { onChainInvoiceId: string | null; gatewayAddress: string | null; gatewayChainId: number | null }) {
  const active = activeGatewayAddress()
  return active && invoice.onChainInvoiceId && invoice.gatewayChainId === QDAY_NETWORK.chainIdDec &&
    invoice.gatewayAddress?.toLowerCase() === active.toLowerCase() ? active : null
}

export async function checkedProvider() {
  const endpoint = new ethers.FetchRequest(QDAY_NETWORK.rpcUrls[0])
  endpoint.timeout = 12_000
  const provider = new ethers.JsonRpcProvider(endpoint)
  if ((await provider.getNetwork()).chainId !== BigInt(QDAY_NETWORK.chainIdDec)) {
    provider.destroy()
    throw new Error('RPC is not on the configured QDay testnet.')
  }
  return provider
}

/** Monetary writes only accept an exact amount with at most six token decimals. */
export function exactAmount(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (!/^\d{1,8}(\.\d{1,6})?$/.test(text)) return null
  const units = ethers.parseUnits(text, 6)
  return units > BigInt(0) ? units : null
}

export function sameAddress(left: string, right: string) {
  return ethers.isAddress(left) && ethers.isAddress(right) && left.toLowerCase() === right.toLowerCase()
}

export function configuredToken() {
  const official = '0x456569838f1d43009A91ebA4263147Afd7233483'
  return sameAddress(CONTRACTS.tUSD8, official) ? official : null
}
