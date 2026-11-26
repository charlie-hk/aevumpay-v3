import type { Metadata } from 'next'
import { CheckoutClient } from './checkout-client'

/**
 * Public checkout route: /pay/<invoiceId>
 *
 * Deliberately outside the dashboard shell — a customer opens the link,
 * connects a wallet and pays, with no login and no merchant UI.
 */

export const metadata: Metadata = {
  title: 'AevumPay — Secure Checkout',
  description: 'Pay this invoice with tUSD8 on the QDay testnet.',
  robots: { index: false, follow: false },
  referrer: 'strict-origin',
}

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CheckoutClient invoiceId={id} />
}
