'use client'

import { useApp, type ViewKey } from '@/store/app'
import { MerchantAvatar } from '@/components/shared/Badges'
import {
  LayoutDashboard,
  FileText,
  ArrowLeftRight,
  Webhook,
  Code2,
  Bot,
  LifeBuoy,
  Sparkles,
  Zap,
  Github,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  key: ViewKey
  label: string
  icon: typeof LayoutDashboard
  desc: string
}

const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, desc: 'Overview & analytics' },
  { key: 'invoices', label: 'Invoices', icon: FileText, desc: 'Create & manage' },
  { key: 'transactions', label: 'Transactions', icon: ArrowLeftRight, desc: 'On-chain history' },
  { key: 'webhooks', label: 'Webhooks', icon: Webhook, desc: 'Event delivery' },
  { key: 'mandates', label: 'Agent Mandates', icon: Bot, desc: 'Spending limits for AI agents' },
  { key: 'contract', label: 'Smart Contract', icon: Code2, desc: 'Solidity source' },
  { key: 'support', label: 'Support', icon: LifeBuoy, desc: 'Live chat' },
]

export function Sidebar() {
  const { view, setView, activeMerchant, setChatOpen } = useApp()

  return (
    <aside className="hidden lg:flex w-[260px] shrink-0 flex-col border-r border-white/5 bg-sidebar/40 backdrop-blur-xl">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 h-[68px] border-b border-white/5">
        <div className="relative size-9 rounded-xl bg-gradient-to-br from-neon via-cyan to-violet flex items-center justify-center shadow-lg glow-neon">
          <Zap className="size-5 text-black" strokeWidth={2.5} fill="black" />
        </div>
        <div className="leading-tight">
          <div className="text-base font-bold tracking-tight">
            Aevum<span className="text-gradient-neon">Pay</span>
          </div>
          <div className="text-[10px] text-muted-foreground font-medium tracking-wider uppercase">
            QDay Testnet
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scroll-styled">
        <div className="px-2 pb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Workspace
        </div>
        {NAV.map((item) => {
          const Icon = item.icon
          const active = view === item.key || (item.key === 'invoices' && view === 'invoice-detail')
          return (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={cn(
                'group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all',
                active
                  ? 'bg-white/[0.06] text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-white/[0.03] hover:text-foreground'
              )}
            >
              <span
                className={cn(
                  'flex size-8 items-center justify-center rounded-md transition-colors',
                  active
                    ? 'bg-neon/15 text-neon'
                    : 'bg-white/[0.03] text-muted-foreground group-hover:text-foreground'
                )}
              >
                <Icon className="size-4" strokeWidth={2} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium leading-tight">{item.label}</span>
                <span className="block text-[11px] text-muted-foreground truncate">{item.desc}</span>
              </span>
              {active && <span className="size-1.5 rounded-full bg-neon pulse-dot" />}
            </button>
          )
        })}

        <div className="px-2 pt-5 pb-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Resources
        </div>
        <a
          href="https://dorahacks.io/hackathon/qday/detail"
          target="_blank"
          rel="noopener noreferrer"
          className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-muted-foreground hover:bg-white/[0.03] hover:text-foreground transition-all"
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-white/[0.03] group-hover:text-foreground">
            <Sparkles className="size-4" />
          </span>
          <span className="flex-1 text-sm font-medium">Aevum Challenge</span>
          <ExternalLink className="size-3.5 opacity-50" />
        </a>
        <a
          href="https://github.com/charlie-hk/aevumpay-v3"
          target="_blank"
          rel="noopener noreferrer"
          className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-muted-foreground hover:bg-white/[0.03] hover:text-foreground transition-all"
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-white/[0.03] group-hover:text-foreground">
            <Github className="size-4" />
          </span>
          <span className="flex-1 text-sm font-medium">View on GitHub</span>
          <ExternalLink className="size-3.5 opacity-50" />
        </a>
      </nav>

      {/* Active merchant card */}
      {activeMerchant && (
        <div className="m-3 p-3 rounded-xl glass">
          <div className="flex items-center gap-3">
            <MerchantAvatar name={activeMerchant.name} color={activeMerchant.avatarColor} size={36} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{activeMerchant.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {activeMerchant.businessName || activeMerchant.email}
              </div>
            </div>
          </div>
          <button
            onClick={() => setChatOpen(true)}
            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neon/10 hover:bg-neon/20 text-neon text-xs font-medium transition-colors"
          >
            <LifeBuoy className="size-3.5" />
            Get support
          </button>
        </div>
      )}
    </aside>
  )
}
