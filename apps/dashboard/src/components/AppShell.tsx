"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { AuthGate } from "@/components/AuthGate";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/rules", label: "Rules" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const {
    address,
    chainId,
    connecting,
    connect,
    disconnect,
    switchToRitual,
    switchToBase,
    switchToSepolia,
    auth,
    signIn,
  } = useWallet();

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-16 pt-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#c8ff4a]">
            Ritual Recurring Agent
          </h1>
          <p className="text-[11px] text-white/40">
            Ritual-first · agent-wallet gated · Base only for live DeFi
          </p>
        </div>
        <nav className="pill-nav glass flex gap-1 rounded-full p-1 text-xs font-medium">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-full px-3 py-1.5 transition ${
                path === n.href ? "active" : "text-white/50 hover:text-white/80"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {address ? (
            <>
              {chainId !== 1979 && chainId !== 8453 && (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => void switchToRitual()}
                >
                  Switch network
                </button>
              )}
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => void switchToRitual()}
              >
                Ritual
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => void switchToSepolia()}
              >
                Sepolia
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => void switchToBase()}
              >
                Base
              </button>
              <span
                className={`hidden font-mono text-[11px] sm:inline ${
                  auth.authorized ? "text-emerald-300/90" : "text-amber-200/80"
                }`}
              >
                {address.slice(0, 6)}…{address.slice(-4)}
                {chainId != null ? ` · ${chainId}` : ""}
                {auth.authorized ? " · owner" : " · locked"}
              </span>
              {!auth.authorized && (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={auth.signingIn}
                  onClick={() => void signIn()}
                >
                  {auth.signingIn ? "Signing…" : "Sign in"}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => void disconnect()}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={connecting || auth.signingIn}
              onClick={() => void connect()}
            >
              {connecting || auth.signingIn ? "…" : "Connect agent wallet"}
            </button>
          )}
        </div>
      </header>
      <AuthGate>{children}</AuthGate>
      <footer className="mt-12 border-t border-white/10 pt-6 text-center text-[11px] text-white/30">
        Dashboard never signs agent txs — the worker EOA executes{" "}
        <b className="text-white/50">live</b> rules on-chain. Only the agent
        wallet can view history after SIWE sign-in.
      </footer>
    </div>
  );
}
