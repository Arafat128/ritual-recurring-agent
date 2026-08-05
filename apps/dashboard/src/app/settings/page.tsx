"use client";

import { useCallback, useEffect, useState } from "react";

export default function SettingsPage() {
  const [status, setStatus] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => {
        setStatus(s);
        setDryRun(Boolean(s.dryRun));
      })
      .catch(() => {});
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleDryRun() {
    setBusy(true);
    setMsg("");
    try {
      const next = !dryRun;
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setDryRun(next);
      setMsg(
        next
          ? "Dry run ON — worker will log txs only (safe)."
          : "Dry run OFF — worker can send LIVE transactions. Fund the agent carefully."
      );
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-[#c8ff4a]">Settings</h2>
        <p className="mt-1 text-sm text-white/45">
          Safety controls for Ritual Recurring Agent.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/35 p-4">
          <div>
            <div className="text-sm font-semibold text-white/90">Dry run</div>
            <p className="mt-1 max-w-md text-[12px] text-white/45">
              When ON, the worker never broadcasts — it only logs would-be
              sends/swaps/bridges (like DeFi Autopilot). Toggle anytime; takes
              effect on the next worker tick.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleDryRun()}
            className={`relative h-10 w-20 shrink-0 rounded-full transition ${
              dryRun
                ? "bg-emerald-500/30 ring-1 ring-emerald-400/50"
                : "bg-rose-500/25 ring-1 ring-rose-400/40"
            }`}
            title="Toggle dry run"
          >
            <span
              className={`absolute top-1 flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold transition ${
                dryRun
                  ? "left-1 bg-emerald-300 text-black"
                  : "left-11 bg-rose-300 text-black"
              }`}
            >
              {dryRun ? "ON" : "OFF"}
            </span>
          </button>
        </div>
        {msg && (
          <p
            className={`mt-3 text-sm ${
              dryRun ? "text-emerald-200/90" : "text-amber-200/90"
            }`}
          >
            {msg}
          </p>
        )}

        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <dt className="text-[10px] uppercase text-white/40">Mode</dt>
            <dd className="mt-1 font-mono text-white/90">
              {dryRun ? "DRY RUN" : "LIVE"}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <dt className="text-[10px] uppercase text-white/40">Agent EOA</dt>
            <dd className="mt-1 break-all font-mono text-[11px] text-white/80">
              {status?.agentEvm || "start worker once to register"}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <dt className="text-[10px] uppercase text-white/40">Max $/tx</dt>
            <dd className="mt-1 font-mono">{config?.limits?.maxTxUsd ?? "—"}</dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <dt className="text-[10px] uppercase text-white/40">Max tx/day</dt>
            <dd className="mt-1 font-mono">
              {config?.limits?.maxTxPerDay ?? "—"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="glass p-6 text-sm text-white/55">
        <h3 className="font-semibold text-cyan-200">Chains</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
          <li>
            <b className="text-white/80">Ritual (1979)</b> — recurring schedules,
            RITUAL sends, ritual_ping.
          </li>
          <li>
            <b className="text-white/80">Sepolia (11155111)</b> — agent testnet
            swaps (Uniswap v3 demo).
          </li>
          <li>
            <b className="text-white/80">Base (8453)</b> — only mainnet for live
            DeFi swaps/bridges (LI.FI).
          </li>
        </ul>
      </div>
    </div>
  );
}
