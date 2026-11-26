'use client'

import { create } from 'zustand'

export type ViewKey =
  | 'dashboard'
  | 'invoices'
  | 'invoice-detail'
  | 'transactions'
  | 'webhooks'
  | 'mandates'
  | 'contract'
  | 'support'

/**
 * The signed-in merchant. This is only ever populated from GET /api/auth/me,
 * i.e. from the server-side session — never from a client-chosen id list.
 */
export interface Merchant {
  id: string
  email: string
  name: string
  businessName: string | null
  walletAddress: string
  avatarColor: string
}

interface AppState {
  view: ViewKey
  setView: (v: ViewKey) => void

  // Authenticated merchant (current session)
  activeMerchant: Merchant | null
  setActiveMerchant: (m: Merchant | null) => void

  // Active invoice (for detail view)
  activeInvoiceId: string | null
  openInvoice: (id: string) => void

  // Support chat panel open state
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
}

export const useApp = create<AppState>((set) => ({
  view: 'dashboard',
  setView: (view) => set({ view }),

  activeMerchant: null,
  setActiveMerchant: (activeMerchant) => set({ activeMerchant }),

  activeInvoiceId: null,
  openInvoice: (id) => set({ activeInvoiceId: id, view: 'invoice-detail' }),

  chatOpen: false,
  setChatOpen: (chatOpen) => set({ chatOpen }),
}))
