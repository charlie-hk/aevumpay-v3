import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "AevumPay — Invoice-based tUSD8 Payment Gateway",
  description:
    "A professional invoice-based stablecoin payment gateway for the Aevum Builder Challenge #1 on the QDay testnet. Built with Next.js, Prisma, and Solidity.",
  keywords: [
    "AevumPay",
    "QDay",
    "tUSD8",
    "payment gateway",
    "invoice",
    "stablecoin",
    "Web3",
    "Solidity",
  ],
  authors: [{ name: "Amini · AevumPay Labs" }],
  openGraph: {
    title: "AevumPay — Stablecoin Payment Gateway",
    description:
      "Invoice-based tUSD8 payment flow on the QDay testnet. Built for the Aevum Builder Challenge #1.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className="font-sans antialiased bg-background text-foreground min-h-screen"
      >
        {children}
        <Toaster />
        <SonnerToaster />
      </body>
    </html>
  );
}
