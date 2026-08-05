import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Ritual Recurring Agent",
  description:
    "Recurring send / swap / bridge agent — Ritual-first, Base mainnet for live DeFi, Sepolia for test swaps.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="site-bg" aria-hidden>
          <div className="site-bg__img" />
          <div className="site-bg__veil" />
        </div>
        <div className="site-content">
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </div>
      </body>
    </html>
  );
}
