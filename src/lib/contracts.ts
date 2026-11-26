/** Shared QDay testnet configuration, compiled into browser builds. */
export const QDAY_NETWORK = {
  chainId: '0xABE5', // 44005 in hex
  chainIdDec: 44005,
  chainName: 'QDay Testnet',
  nativeCurrency: { name: 'QDay', symbol: 'QDAY', decimals: 18 },
  rpcUrls: [process.env.NEXT_PUBLIC_QDAY_RPC_URL || 'https://rpc-test.qday.info'],
  blockExplorerUrls: ['https://explorer-test.qday.info'],
}

export const EXPLORER_BASE = 'https://explorer-test.qday.info'

/** Supported contract versions. V2 is the default; V3 is opt-in only. */
export type ContractVersion = '2' | '3'

/**
 * Negotiated contract version. Defaults to V2 — a V3 gateway must be deployed
 * and verified before switching, and the switch requires a fresh database.
 */
export const CONTRACT_VERSION: ContractVersion =
  process.env.NEXT_PUBLIC_AEVUMPAY_CONTRACT_VERSION === '3' ? '3' : '2'

export const V2_GATEWAY_ADDRESS = '0x21A07B6DC9b565F2734cE12b68A63Cc971A534aC'
export const V3_GATEWAY_ADDRESS = process.env.NEXT_PUBLIC_GATEWAY_ADDRESS || ''

export const CONTRACTS = {
  gateway: CONTRACT_VERSION === '3' ? V3_GATEWAY_ADDRESS : V2_GATEWAY_ADDRESS,
  // Official testnet tUSD8 token (6 decimals)
  tUSD8: '0x456569838f1d43009A91ebA4263147Afd7233483',
} as const

/**
 * V2 and V3 share the same invoice/event shape; only the address differs.
 * Returns the gateway address for the active version, or null when the
 * deployment has not happened yet — callers must then run in database-only
 * mode instead of guessing an address.
 */
export function activeGatewayAddress(): string | null {
  const addr = CONTRACTS.gateway
  return addr && /^0x[0-9a-fA-F]{40}$/.test(addr) && (CONTRACT_VERSION !== '3' || addr.toLowerCase() !== V2_GATEWAY_ADDRESS.toLowerCase()) ? addr : null
}

/** True when an on-chain gateway is configured for the active version. */
export function isOnChainEnabled(): boolean {
  return activeGatewayAddress() !== null
}

export const DEPLOYMENT_INFO = {
  network: 'qday-testnet',
  chainId: 44005,
  version: CONTRACT_VERSION,
  /** Address is deployment-specific; never assume a hardcoded contract. */
  gateway: CONTRACTS.gateway || null,
} as const

/**
 * Minimal ABI for AevumPaymentGateway — only the functions used by the frontend.
 * For the full ABI, see contracts/contracts/AevumPaymentGateway.sol.
 */
export const GATEWAY_ABI = [
  // Read
  {
    inputs: [{ name: 'invoiceId', type: 'bytes32' }],
    name: 'getInvoice',
    outputs: [
      {
        components: [
          { name: 'id', type: 'bytes32' },
          { name: 'merchant', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'payer', type: 'address' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'paidAt', type: 'uint256' },
          { name: 'orderRef', type: 'string' },
          { name: 'feePaid', type: 'uint256' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'invoiceId', type: 'bytes32' }],
    name: 'isInvoicePaid',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'feeBps',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'pendingFees',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Write
  {
    inputs: [{ name: 'invoiceId', type: 'bytes32' }],
    name: 'pay',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'invoiceId', type: 'bytes32' },
      { indexed: true, name: 'merchant', type: 'address' },
      { indexed: true, name: 'payer', type: 'address' },
      { indexed: false, name: 'token', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'networkFee', type: 'uint256' },
      { indexed: false, name: 'paidAt', type: 'uint256' },
    ],
    name: 'InvoicePaid',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'invoiceId', type: 'bytes32' },
      { indexed: true, name: 'merchant', type: 'address' },
      { indexed: false, name: 'token', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'expiresAt', type: 'uint256' },
      { indexed: true, name: 'orderRef', type: 'string' },
    ],
    name: 'InvoiceCreated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'invoiceId', type: 'bytes32' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'refundedAt', type: 'uint256' },
    ],
    name: 'InvoiceRefunded',
    type: 'event',
  },
] as const

/**
 * Minimal ABI for ERC-20 (approve + allowance)
 */
export const ERC20_ABI = [
  {
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

/**
 * Agent mandates live on the V3 gateway only (V2 has no grantMandate).
 * The mandate page uses the V3 address from the environment when set,
 * otherwise the V3 gateway recorded in contracts/deployments/qday-v3-candidate.json.
 * This never changes the gateway used for invoices and checkout.
 */
export const V3_DEPLOYED_ADDRESS = '0x6935DC350d790A11FF227841130B9de1642A865a'
export const MANDATE_GATEWAY_ADDRESS: string = /^0x[0-9a-fA-F]{40}$/.test(V3_GATEWAY_ADDRESS)
  ? V3_GATEWAY_ADDRESS
  : V3_DEPLOYED_ADDRESS

export const MANDATE_ABI = [
  'function grantMandate(address agent, address token, address merchant, uint256 maxPerInvoice, uint256 totalCap, uint64 validUntil)',
  'function revokeMandate(address agent)',
  'function mandateRemaining(address payer, address agent) view returns (uint256)',
  'function mandates(address payer, address agent) view returns (address token, address merchant, uint256 maxPerInvoice, uint256 totalCap, uint256 spent, uint64 validUntil, bool active)',
] as const
