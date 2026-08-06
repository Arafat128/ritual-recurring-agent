"use client";

import { useWallet } from "@/lib/wallet";

/**
 * Blocks sensitive dashboard content until the connected wallet has signed
 * in as the agent (or OWNER_ADDRESSES). Wrong wallets see no history/rules.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { address, connecting, connect, auth, signIn } = useWallet();

  if (auth.authorized) {
    return <>{children}</>;
  }

  const agent = auth.agentEvm;
  const agentShort = agent
    ? `${agent.slice(0, 6)}…${agent.slice(-4)}`
    : "agent EOA";

  return (
    <div className="glass mx-auto max-w-lg space-y-4 p-6 text-center">
      <h2 className="text-lg font-semibold text-[#c8ff4a]">
        Agent wallet required
      </h2>
      <p className="text-sm text-white/55">
        Rules, activity history, and limits are private to the{" "}
        <b className="text-white/80">agent EOA</b>. Connecting any other wallet
        will not show that data.
      </p>

      {agent && (
        <p className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-[12px] text-cyan-200/90">
          Required: {agentShort}
          <span className="mt-1 block break-all text-[10px] text-white/40">
            {agent}
          </span>
        </p>
      )}

      {!agent && (
        <p className="text-[12px] text-amber-200/80">
          Agent not registered yet. Start the worker once so the agent EOA is
          saved, then connect that wallet here.
        </p>
      )}

      {address && !auth.authorized && (
        <p className="text-[12px] text-rose-200/85">
          Connected {address.slice(0, 6)}…{address.slice(-4)} is not authorized.
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
            {connecting || auth.signingIn ? "…" : "Connect agent wallet"}
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
        Sign-in uses a free signature (no gas). Session is HttpOnly and expires
        in 24h.
      </p>
    </div>
  );
}
