import { PrismaClient } from '@prisma/client'
import { CONTRACT_VERSION, activeGatewayAddress } from '@/lib/contracts'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  return new PrismaClient()
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Fail-closed guard for V3 mode.
 *
 * V3 must only ever run against a fresh, isolated database. If the operator has
 * set AEVUMPAY_CONTRACT_VERSION=3 but left rows from a previous deployment in
 * place, those rows have no verifiable on-chain provenance and must not be
 * served as accounting data. We refuse the query rather than silently mixing
 * them into the dashboard.
 */
export async function assertNoLegacyRowsForV3(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (CONTRACT_VERSION !== '3') return { ok: true }

  const foreign = await db.invoice.count({ where: { OR: [{ gatewayAddress: null }, { gatewayAddress: { not: activeGatewayAddress()?.toLowerCase() || '' } }, { gatewayChainId: null }, { gatewayChainId: { not: 44005 } }] } })
  if (foreign) return { ok: false, error: 'V3 requires a separate database. Keep existing invoices under their original gateway.' }

  return { ok: true }
}

/**
 * Only ONCHAIN settlements count toward volume, fees, conversion and token
 * distribution. SIMULATED (demo) and HISTORICAL_SEED (fixture) rows are shown
 * for context but excluded from every financial figure.
 */
export const ACCOUNTED_SETTLEMENT = 'ONCHAIN' as const

export type SettlementSource = 'ONCHAIN' | 'SIMULATED' | 'HISTORICAL_SEED'

/**
 * Demo settlement (labelled, excluded from accounting).
 *
 * This is a *database-only* fixture path for legacy invoices and is always off
 * in production. In development it can be enabled explicitly with
 * DEMO_SETTLEMENT=true so the seeded demo invoices can be exercised end-to-end.
 * It never produces a tx hash and never counts toward any financial figure.
 */
export function demoSettlementEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.DEMO_SETTLEMENT === 'true'
}

/**
 * Seeding of demo fixtures is an operator action, never automatic:
 *   - never available in production;
 *   - in development it requires ALLOW_DEMO_SEED=true explicitly.
 */
export function seedingEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.ALLOW_DEMO_SEED === 'true'
}

