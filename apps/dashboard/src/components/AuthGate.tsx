"use client";

import Link from "next/link";
import { useWallet } from "@/lib/wallet";

/**
 * Blocks sensitive dashboard content until the user has signed in.
 * Multi-tenant: any wallet can sign in and manage its own rules/credit.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { address, connecting, connect, auth, signIn } = useWallet();

  if (auth.authorized) {
    return <>{children}</>;
  }

  return (
    <div className="glass mx-auto max-w-lg space-y-4 p-6 text-center">
      <h2 className="text-lg font-semibold text-[#c8ff4a]">
        Sign in with your wallet
      </h2>
      <p className="text-sm text-white/55">
        This is a <b className="text-white/80">multi-user</b> agent service.
        Connect <b className="text-white/80">your</b> wallet, top up RITUAL
        credit, create rules, and the shared operator burner executes them.
      </p>

      <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white/50">
        Free signature to log in (no gas). Rules and history stay private to
        your address. See the{" "}
        <Link href="/guide" className="text-cyan-300 underline">
          setup guide
        </Link>
        .
      </p>

      {address && !auth.authorized && (
        <p className="text-[12px] text-amber-200/85">
          Connected {address.slice(0, 6)}…{address.slice(-4)} — sign in to
          unlock your rules.
          {auth.authError ? ` ${auth.authError}` : ""}
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {!address ? (
          <button
            type="button"
            className="btn-primary"
            disabled={connecting || auth.signingIn}
            onClick={() => void connect()}
          >
            {connecting || auth.signingIn ? "…" : "Connect wallet"}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={auth.signingIn}
            onClick={() => void signIn()}
          >
            {auth.signingIn ? "Check wallet…" : "Sign in to unlock"}
          </button>
        )}
      </div>

      <p className="text-[10px] text-white/35">
        Session is HttpOnly and expires in 24h. Operators run a separate worker
        with the burner key.
      </p>
    </div>
  );
}
