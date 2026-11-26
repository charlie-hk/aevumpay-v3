'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import {
  X,
  Send,
  MessageCircle,
  Bot,
  User,
  Loader2,
  Minus,
  Sparkles,
  CheckCircle2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useApp } from '@/store/app'

interface ChatMessage {
  id: string
  sessionId: string
  sender: 'customer' | 'support' | 'bot'
  content: string
  timestamp: string
}

// ────────────────────────── Bot reply engine ──────────────────────────
// This runs entirely client-side for the demo. In production, these messages
// can be replaced by a support backend. This version uses local rules.
const BOT_REPLIES: { match: RegExp; reply: string }[] = [
  {
    match: /hello|hi|hey|salam/i,
    reply: "Hi there! 👋 Thanks for reaching out to AevumPay support. I'm Aria, your support bot. How can I help you with your payment today?",
  },
  {
    match: /invoice|pay|payment/i,
    reply: "For invoice payments: open the invoice link, scan the QR code with your wallet (Rainbow, MetaMask Mobile), and approve the tUSD8 transfer. Payments typically confirm in ~3 seconds on the QDay testnet. Anything specific I can help with?",
  },
  {
    match: /usdt|tusd|token/i,
    reply: "We support both tUSD8 (testnet, free from the faucet) and USDT (mainnet). On the QDay testnet, call `faucet()` on the tUSD8 contract to claim 1,000 tUSD8 every 24h. Want me to show you the contract address?",
  },
  {
    match: /qr|scan/i,
    reply: "The QR code encodes an EIP-681 payment URI: `ethereum:pay-<gateway>?amount=...&token=tUSD8`. Most mobile wallets support it natively. On desktop, click 'Simulate Pay' to test the flow without a wallet.",
  },
  {
    match: /fee|gas|cost/i,
    reply: "AevumPay charges 0.25% platform fee on each paid invoice. Network gas on QDay testnet is currently free. No hidden charges, ever. The fee is configurable by the gateway owner (max 5%).",
  },
  {
    match: /refund/i,
    reply: "Refunds are issued by the merchant directly from the gateway contract (`refund(invoiceId, to)`). Once refunded, the invoice status flips to REFUNDED and funds return to the original payer address. The merchant cannot refund more than the invoice amount.",
  },
  {
    match: /webhook/i,
    reply: "Webhooks fire on `invoice.created`, `invoice.paid`, `invoice.expired`, and `invoice.refunded`. Add your endpoint in Settings → Webhooks. We sign each payload with HMAC-SHA256 using your endpoint secret.",
  },
  {
    match: /contract|solidity|deploy|code/i,
    reply: "Our smart contracts are open-source testnet software, not audited for mainnet. Check the 'Smart Contract' tab in the sidebar to view the Solidity source. Deploy with `npm run deploy` in the /download/contracts folder — full instructions are in the README.",
  },
  {
    match: /challenge|aevum|hackathon|qday/i,
    reply: "The Aevum Builder Challenge #1 runs Nov 16 – Dec 11 on the QDay testnet, with $1,500 USDT in prizes. Top 5 projects present at Demo Day on Dec 15. Details: https://dorahacks.io/hackathon/qday/detail — good luck! 🚀",
  },
  {
    match: /thank|thanks|merci|khaste|ممنون/i,
    reply: "You're very welcome! If you have any other questions, I'm here 24/7. Good luck with the Aevum Builder Challenge! 🚀",
  },
  {
    match: /help|support/i,
    reply: "I can help with: invoices, payments, tokens (tUSD8), QR codes, fees, refunds, webhooks, smart contracts, and the Aevum Challenge. What would you like to know?",
  },
  {
    match: /security|safe|secure|audit/i,
    reply: "Security: our contracts use ReentrancyGuard, Pausable, token whitelisting, and immediate net merchant settlement with fee escrow. Before mainnet we'll do a formal audit + multisig ownership. The Solidity is open-source for review.",
  },
]

function botReply(content: string): string {
  for (const { match, reply } of BOT_REPLIES) {
    if (match.test(content)) return reply
  }
  return "Thanks for your message! I've forwarded this to our support team — they'll respond shortly. In the meantime, you can check the Smart Contract tab for technical docs, or the Invoices tab to see live payment flows. Anything specific about invoices, tokens, webhooks, or our contracts I can help with?"
}

const QUICK_REPLIES = [
  'How do I pay an invoice?',
  'What tokens are supported?',
  'How do webhooks work?',
  'Show me the contract',
  'Tell me about the Aevum Challenge',
]

const genId = () => Math.random().toString(36).slice(2, 11)

export function SupportChatWidget() {
  const { chatOpen, setChatOpen, activeMerchant } = useApp()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [sessionStarted, setSessionStarted] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, typing])

  // Start session when chat opens
  useEffect(() => {
    if (chatOpen && !sessionStarted) {
      setSessionStarted(true)
      const customerName = activeMerchant?.name || 'there'
      const welcome: ChatMessage = {
        id: genId(),
        sessionId: '0',
        sender: 'bot',
        content: `Welcome to AevumPay support, ${customerName}! 👋 I'm Aria, a rule-based help bot. I can answer questions about invoices, payments, tokens (tUSD8), webhooks, our smart contracts, and the Aevum Builder Challenge. What can I help you with?`,
        timestamp: new Date().toISOString(),
      }
      setMessages([welcome])
    }
  }, [chatOpen, sessionStarted, activeMerchant])

  const send = useCallback((text?: string) => {
    const content = (text ?? input).trim()
    if (!content) return
    const userMsg: ChatMessage = {
      id: genId(),
      sessionId: '0',
      sender: 'customer',
      content,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setTyping(true)

    // Bot replies after a realistic delay
    const delay = 700 + Math.random() * 900
    if (typingTimeout.current) clearTimeout(typingTimeout.current)
    typingTimeout.current = setTimeout(() => {
      const botMsg: ChatMessage = {
        id: genId(),
        sessionId: '0',
        sender: 'bot',
        content: botReply(content),
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, botMsg])
      setTyping(false)
    }, delay)
  }, [input])

  if (!chatOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-end sm:justify-end p-0 sm:p-4 pointer-events-none">
      {/* Backdrop on mobile */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm sm:hidden pointer-events-auto"
        onClick={() => setChatOpen(false)}
      />
      <Card className="relative w-full sm:w-[400px] h-[100vh] sm:h-[600px] max-h-[100vh] sm:max-h-[80vh] glass-strong border-white/10 flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl pointer-events-auto overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5 bg-gradient-to-r from-neon/[0.08] to-violet/[0.08]">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="size-10 rounded-xl bg-gradient-to-br from-neon via-cyan to-violet flex items-center justify-center">
                <Sparkles className="size-5 text-black" fill="black" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-neon pulse-dot" />
            </div>
            <div>
              <div className="font-semibold text-sm">AevumPay Support</div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-neon" /> Online · Aria help bot
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={() => setChatOpen(false)}
              aria-label="Minimize"
            >
              <Minus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={() => setChatOpen(false)}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Subject line */}
        <div className="px-4 py-2 bg-violet/[0.04] border-b border-white/5 text-[11px] text-muted-foreground flex items-center gap-2">
          <MessageCircle className="size-3 text-violet" />
          Subject: <span className="text-foreground font-medium">Invoice payment help</span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-styled p-4 space-y-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
          {typing && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="size-6 rounded-full bg-violet/20 flex items-center justify-center">
                <Bot className="size-3 text-violet" />
              </div>
              <div className="flex gap-1">
                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>

        {/* Quick replies */}
        {messages.length <= 1 && (
          <div className="px-4 py-2 border-t border-white/5 flex flex-wrap gap-1.5">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 text-[11px] hover:bg-white/[0.08] transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Type a message…"
              className="bg-white/[0.03] border-white/10"
            />
            <Button
              onClick={() => send()}
              disabled={!input.trim()}
              size="icon"
              className="bg-neon text-black hover:bg-neon/90 size-10 shrink-0"
            >
              <Send className="size-4" />
            </Button>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="size-2.5 text-neon" />
            Rule-based help · No live agent
          </div>
        </div>
      </Card>
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isCustomer = msg.sender === 'customer'
  const isBot = msg.sender === 'bot'
  return (
    <div className={`flex items-start gap-2 ${isCustomer ? 'flex-row-reverse' : ''}`}>
      <div
        className={`size-7 rounded-full flex items-center justify-center shrink-0 ${
          isCustomer ? 'bg-neon/20' : isBot ? 'bg-violet/20' : 'bg-cyan/20'
        }`}
      >
        {isCustomer ? (
          <User className="size-3.5 text-neon" />
        ) : isBot ? (
          <Bot className="size-3.5 text-violet" />
        ) : (
          <Sparkles className="size-3.5 text-cyan" />
        )}
      </div>
      <div className={`max-w-[78%] ${isCustomer ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`px-3 py-2 rounded-2xl text-sm ${
            isCustomer
              ? 'bg-neon text-black rounded-tr-sm font-medium'
              : isBot
              ? 'bg-violet/15 border border-violet/20 text-foreground rounded-tl-sm'
              : 'bg-white/[0.06] border border-white/10 text-foreground rounded-tl-sm'
          }`}
        >
          {msg.content}
        </div>
        <div className="text-[10px] text-muted-foreground mt-1 px-1">
          {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

// Full-page support view (for the sidebar nav)
export function SupportView() {
  const { setChatOpen } = useApp()
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Support</h1>
        <p className="text-sm text-muted-foreground">
          Chat with Aria, the automated help bot.
        </p>
      </div>
      <Card className="p-8 glass border-white/5 text-center">
        <div className="size-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-neon via-cyan to-violet flex items-center justify-center glow-neon">
          <Sparkles className="size-8 text-black" fill="black" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Aria is online and ready to help</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
          Click the button below to start a chat. Aria can answer questions about invoices,
          payments, tokens, webhooks, smart contracts, and the Aevum Builder Challenge.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-lg mx-auto mb-6">
          {[
            { label: 'Invoices', count: '12 topics' },
            { label: 'Payments', count: '8 topics' },
            { label: 'Webhooks', count: '6 topics' },
            { label: 'Contracts', count: '15 topics' },
          ].map((t) => (
            <div key={t.label} className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="text-xs font-medium">{t.label}</div>
              <div className="text-[10px] text-muted-foreground">{t.count}</div>
            </div>
          ))}
        </div>
        <Button
          onClick={() => setChatOpen(true)}
          className="bg-neon text-black hover:bg-neon/90 gap-1.5"
        >
          <MessageCircle className="size-4" /> Start Chat with Aria
        </Button>
      </Card>
    </div>
  )
}
