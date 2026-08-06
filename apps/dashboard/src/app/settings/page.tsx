"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";

type Limits = {
  maxTxUsd: number;
  maxTxPerDay: number;
  loopIntervalMs: number;
};

export default function SettingsPage() {
  const [status, setStatus] = useState<any>(null);
  const [maxTxUsd, setMaxTxUsd] = useState("25");
  const [maxTxPerDay, setMaxTxPerDay] = useState("20");
  const [loopSec, setLoopSec] = useState("30");
  const [usageToday, setUsageToday] = useState(0);
  const [savingLimits, setSavingLimits] = useState(false);
  const [limitsMsg, setLimitsMsg] = useState("");

  const applyLimits = useCallback((limits: Limits) => {
    setMaxTxUsd(String(limits.maxTxUsd));
    setMaxTxPerDay(String(limits.maxTxPerDay));
    setLoopSec(String(Math.round(limits.loopIntervalMs / 1000)));
  }, []);

  const load = useCallback(() => {
    api("/api/settings")
      .then(async (r) => {
        if (!r.ok) return;
        const s = await r.json();
        setStatus(s);
        if (s.limits) applyLimits(s.limits as Limits);
        if (s.usage?.actionsToday != null) setUsageToday(s.usage.actionsToday);
      })
      .catch(() => {});
    api("/api/status")
      .then(async (r) => {
        if (!r.ok) return;
        const s = await r.json();
        setStatus((prev: any) => ({ ...prev, agentEvm: s.agentEvm, ...s }));
        if (s.limits) applyLimits(s.limits as Limits);
        if (s.usage?.actionsToday != null) setUsageToday(s.usage.actionsToday);
      })
      .catch(() => {});
  }, [applyLimits]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveLimits(e: FormEvent) {
    e.preventDefault();
    setSavingLimits(true);
    setLimitsMsg("");
    try {
      const usd = Number(maxTxUsd);
      const day = Math.floor(Number(maxTxPerDay));
      const sec = Math.floor(Number(loopSec));
      if (!Number.isFinite(usd) || usd < 0.01) {
        throw new Error("Max $/tx must be at least 0.01");
      }
      if (!Number.isFinite(day) || day < 1) {
        throw new Error("Max tx/day must be at least 1");
      }
      if (!Number.isFinite(sec) || sec < 10 || sec > 600) {
        throw new Error("Worker interval must be 10–600 seconds");
      }
      const res = await api("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxTxUsd: usd,
          maxTxPerDay: day,
          loopIntervalSec: sec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      if (data.limits) applyLimits(data.limits as Limits);
      setLimitsMsg(
        "Saved. Limits apply on the next worker tick; loop interval updates after the current wait.",
      );
      load();
    } catch (err) {
      setLimitsMsg(err instanceof Error ? err.message : "error");
    } finally {
      setSavingLimits(false);
    }
  }

  const dayCap = Number(maxTxPerDay) || 0;
  const usagePct =
    dayCap > 0 ? Math.min(100, Math.round((usageToday / dayCap) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-[#c8ff4a]">Settings</h2>
        <p className="mt-1 text-sm text-white/45">
          Safety limits for Ritual Recurring Agent. Stored in SQLite and
          re-read by the worker each tick — no restart required.
        </p>

        <div className="mt-6 rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4">
          <div className="text-sm font-semibold text-rose-100">
            LIVE execution
          </div>
          <p className="mt-1 max-w-xl text-[12px] text-white/55">
            Dry run is removed. The worker broadcasts real transactions when
            rules fire. Use a funded burner key on Ritual testnet for sends.
            Keep <code className="text-white/70">maxTxUsd</code> /{" "}
            <code className="text-white/70">maxTxPerDay</code> low while testing.
          </p>
        </div>

        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <dt className="text-[10px] uppercase text-white/40">Mode</dt>
            <dd className="mt-1 font-mono text-rose-200">LIVE</dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <dt className="text-[10px] uppercase text-white/40">Agent EOA</dt>
            <dd className="mt-1 break-all font-mono text-[11px] text-white/80">
              {status?.agentEvm || "set AGENT_PRIVATE_KEY and start worker"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="glass p-6">
        <h3 className="text-sm font-semibold text-cyan-200">App limits</h3>
        <p className="mt-1 text-[12px] text-white/45">
          Cap how much the agent can do. These override{" "}
          <code className="text-white/60">MAX_TX_USD</code> /{" "}
          <code className="text-white/60">MAX_TX_PER_DAY</code> from{" "}
          <code className="text-white/60">.env</code> once saved.
        </p>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-white/50">
              Usage today (UTC) — executed txs toward the cap
            </span>
            <span className="font-mono text-white/85">
              {usageToday} / {maxTxPerDay || "—"} txs
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all ${
                usagePct >= 90
                  ? "bg-rose-400"
                  : usagePct >= 60
                    ? "bg-amber-400"
                    : "bg-[#c8ff4a]"
              }`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>

        <form onSubmit={(e) => void saveLimits(e)} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-white/40">
                Max USD per tx
              </span>
              <input
                type="number"
                min={0.01}
                max={1_000_000}
                step="0.01"
                value={maxTxUsd}
                onChange={(e) => setMaxTxUsd(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-cyan-400/50"
              />
              <span className="mt-1 block text-[10px] text-white/35">
                Skip if estimated $ value exceeds this
              </span>
            </label>

            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-white/40">
                Max transactions / day
              </span>
              <input
                type="number"
                min={1}
                max={10_000}
                step={1}
                value={maxTxPerDay}
                onChange={(e) => setMaxTxPerDay(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-cyan-400/50"
              />
              <span className="mt-1 block text-[10px] text-white/35">
                UTC day cap (executed only)
              </span>
            </label>

            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-white/40">
                Worker interval (seconds)
              </span>
              <input
                type="number"
                min={10}
                max={600}
                step={1}
                value={loopSec}
                onChange={(e) => setLoopSec(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-cyan-400/50"
              />
              <span className="mt-1 block text-[10px] text-white/35">
                How often the agent checks rules (10–600s)
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={savingLimits}
              className="btn-primary disabled:opacity-50"
            >
              {savingLimits ? "Saving…" : "Save limits"}
            </button>
            <button
              type="button"
              disabled={savingLimits}
              onClick={() => {
                setMaxTxUsd("25");
                setMaxTxPerDay("20");
                setLoopSec("30");
              }}
              className="btn-ghost text-[12px]"
            >
              Reset fields to defaults
            </button>
          </div>
          {limitsMsg && (
            <p
              className={`text-sm ${
                limitsMsg.startsWith("Saved")
                  ? "text-emerald-200/90"
                  : "text-rose-300/90"
              }`}
            >
              {limitsMsg}
            </p>
          )}
        </form>
      </div>

      <div className="glass p-6 text-sm text-white/55">
        <h3 className="font-semibold text-cyan-200">Chains</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
          <li>
            <b className="text-white/80">Ritual (1979)</b> — recurring
            schedules, RITUAL sends, ritual_ping.
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
