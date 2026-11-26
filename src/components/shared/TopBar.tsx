'use client'

import { useApp, type ViewKey } from '@/store/app'
import { MerchantAvatar } from '@/components/shared/Badges'
import {
  Menu,
  Plus,
  LifeBuoy,
  LayoutDashboard,
  FileText,
  ArrowLeftRight,
  Webhook,
  Code2,
  Bot,
  X,
  LogOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { Merchant } from '@/store/app'

interface TopBarProps {
  activeMerchant: Merchant | null
  onCreateInvoice: () => void
  onSignOut: () => void
}

const MOBILE_NAV: { key: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'transactions', label: 'Txns', icon: ArrowLeftRight },
  { key: 'webhooks', label: 'Webhooks', icon: Webhook },
  { key: 'mandates', label: 'Agents', icon: Bot },
  { key: 'contract', label: 'Contract', icon: Code2 },
]

export function TopBar({ activeMerchant, onCreateInvoice, onSignOut }: TopBarProps) {
  const { setView, setChatOpen, view } = useApp()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Close mobile nav on view change
  useEffect(() => {
    setMobileNavOpen(false)
  }, [view])

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 px-4 lg:px-6 h-[68px] border-b border-white/5 bg-background/80 backdrop-blur-xl">
        {/* Mobile menu */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>

        {/* Brand on mobile */}
        <div className="lg:hidden flex items-center gap-2">
          <div className="size-7 rounded-lg bg-gradient-to-br from-neon via-cyan to-violet flex items-center justify-center">
            <span className="text-[10px] font-black text-black">A</span>
          </div>
          <span className="text-sm font-bold">AevumPay</span>
        </div>

        {/* Signed-in merchant (identity comes from the server session) */}
        {activeMerchant && (
          <div className="hidden lg:flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
            <MerchantAvatar name={activeMerchant.name} color={activeMerchant.avatarColor} size={28} />
            <div className="text-left leading-tight">
              <div className="text-sm font-semibold">{activeMerchant.name}</div>
              <div className="text-[10px] text-muted-foreground">{activeMerchant.businessName}</div>
            </div>
          </div>
        )}

        <div className="flex-1" />

        {/* Network indicator */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
          <span className="size-2 rounded-full bg-neon pulse-dot" />
          <span className="text-xs font-medium">QDay Testnet</span>
          <span className="text-[10px] text-muted-foreground font-mono">·</span>
          <span className="text-[10px] text-muted-foreground font-mono">chain 44005</span>
        </div>

        {/* Support */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setChatOpen(true)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Open support chat"
        >
          <LifeBuoy className="size-5" />
        </Button>

        {/* Sign out */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onSignOut}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="size-5" />
        </Button>

        {/* Create invoice */}
        <Button
          onClick={onCreateInvoice}
          className="bg-neon text-black hover:bg-neon/90 font-semibold gap-1.5 shadow-lg glow-neon"
        >
          <Plus className="size-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">New Invoice</span>
          <span className="sm:hidden">New</span>
        </Button>
      </header>

      {/* Mobile nav drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="absolute left-0 top-0 bottom-0 w-72 bg-sidebar border-r border-white/5 p-4 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-gradient-to-br from-neon via-cyan to-violet flex items-center justify-center">
                  <span className="text-xs font-black text-black">A</span>
                </div>
                <span className="font-bold">AevumPay</span>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(false)}>
                <X className="size-5" />
              </Button>
            </div>
            {activeMerchant && (
              <div className="flex items-center gap-3 p-3 mb-4 rounded-lg glass">
                <MerchantAvatar name={activeMerchant.name} color={activeMerchant.avatarColor} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{activeMerchant.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {activeMerchant.businessName}
                  </div>
                </div>
              </div>
            )}
            <nav className="space-y-1">
              {MOBILE_NAV.map((item) => {
                const Icon = item.icon
                const active = view === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      useApp.getState().setView(item.key)
                      setMobileNavOpen(false)
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
                      active ? 'bg-white/[0.06] text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </button>
                )
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
