"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const STATUS_CLS: Record<string, string> = {
  executed: "text-emerald-300 bg-emerald-400/10",
  dry_run: "text-purple-200 bg-purple-400/10",
  error: "text-rose-300 bg-rose-400/10",
  skipped: "text-white/50 bg-white/5",
  pending: "text-white/60 bg-white/10",
  executing: "text-cyan-200 bg-cyan-400/10",
};

export default function OverviewPage() {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, [load]);

  async function toggleDry() {
    setBusy(true);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: !status?.dryRun }),
      });
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="mb-1 text-2xl font-semibold text-white">Overview</h2>
            <p className="max-w-xl text-sm text-white/45">
              Recurring{" "}
              <b className="text-white/70">send · swap · bridge</b> rules —
              Ritual-first, Sepolia for test swaps,{" "}
              <span className="text-cyan-300">Base mainnet</span> only for live
              DeFi.
            </p>
          </div>
          <button
            type="button"
            disabled={busy || status == null}
            onClick={() => void toggleDry()}
            className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition ${
              status?.dryRun
                ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                : "border border-rose-400/40 bg-rose-500/20 text-rose-100"
            }`}
          >
            Dry run: {status?.dryRun === false ? "OFF · LIVE" : "ON"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {[
            ["Dry run", status?.dryRun === false ? "LIVE" : "ON"],
            ["Active rules", status?.counts?.active ?? "—"],
            ["Actions", status?.counts?.actions ?? "—"],
            [
              "Worker",
              status?.worker?.lastTickAt
                ? new Date(status.worker.lastTickAt).toLocaleTimeString()
                : "offline?",
            ],
          ].map(([k, v]) => (
            <div
              key={k}
              className="rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <div className="text-[10px] uppercase text-white/40">{k}</div>
              <div className="mt-1 font-mono text-sm text-white/90">{v}</div>
            </div>
          ))}
        </div>
        {status?.agentEvm && (
          <p className="mt-3 font-mono text-[11px] text-white/40">
            Agent EOA: {status.agentEvm}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/rules" className="btn-primary">
            Create rule
          </Link>
          <Link href="/settings" className="btn-ghost">
            Settings
          </Link>
        </div>
      </div>

      <div className="glass p-5">
        <h3 className="mb-3 text-sm font-semibold text-[#c8ff4a]">
          Activity feed
        </h3>
        <ul className="space-y-2">
          {(status?.actions || []).length === 0 && (
            <li className="text-sm text-white/40">
              No actions yet — start the worker and create a scheduled send /
              swap.
            </li>
          )}
          {(status?.actions || []).map((a: any) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs"
            >
              <span className="text-white/75">{a.summary}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  STATUS_CLS[a.status] || "bg-white/10 text-white/50"
                }`}
              >
                {a.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
