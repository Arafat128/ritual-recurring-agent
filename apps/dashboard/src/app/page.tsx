"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  chainLabel,
  explorerTxUrl,
  shortHash,
} from "@/lib/explorer";
import { api } from "@/lib/api";

const STATUS_CLS: Record<string, string> = {
  executed: "text-emerald-300 bg-emerald-400/10",
  dry_run: "text-purple-200 bg-purple-400/10",
  error: "text-rose-300 bg-rose-400/10",
  skipped: "text-white/50 bg-white/5",
  pending: "text-white/60 bg-white/10",
  executing: "text-cyan-200 bg-cyan-400/10",
};

type ActionRow = {
  id: string;
  type: string;
  status: string;
  chainId: number;
  summary: string;
  command?: string | null;
  txHash?: string | null;
  error?: string | null;
  createdAt: string;
};

const DELETABLE_STATUSES = new Set(["dry_run", "error"]);

export default function OverviewPage() {
  const [status, setStatus] = useState<any>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  const load = useCallback(() => {
    api("/api/status")
      .then(async (r) => {
        if (!r.ok) {
          setStatus(null);
          return;
        }
        setStatus(await r.json());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, [load]);

  const actions = (status?.actions || []) as ActionRow[];
  const deletableCount = actions.filter((a) =>
    DELETABLE_STATUSES.has(a.status),
  ).length;

  async function copyHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(hash);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* ignore */
    }
  }

  async function deleteAction(id: string) {
    setDeleting(id);
    try {
      const res = await api("/api/actions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        alert(data.error || "Delete failed");
        return;
      }
      load();
    } finally {
      setDeleting(null);
    }
  }

  async function clearDeletable() {
    if (deletableCount === 0) return;
    if (
      !confirm(
        `Remove ${deletableCount} failed / legacy action(s) from history?\nExecuted transactions are kept.`,
      )
    ) {
      return;
    }
    setDeleting("bulk");
    try {
      const res = await api("/api/actions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: "deletable" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        alert(data.error || "Clear failed");
        return;
      }
      load();
    } finally {
      setDeleting(null);
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
              DeFi. All actions execute on-chain.
            </p>
          </div>
          <span className="rounded-full border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-xs font-bold uppercase tracking-wide text-rose-100">
            LIVE · on-chain
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {[
            ["Active rules", status?.counts?.active ?? "—"],
            ["Actions", status?.counts?.actions ?? "—"],
            [
              "Today / cap",
              status?.limits
                ? `${status?.usage?.actionsToday ?? 0}/${status.limits.maxTxPerDay}`
                : "—",
            ],
            [
              "Max $/tx",
              status?.limits?.maxTxUsd != null
                ? `$${status.limits.maxTxUsd}`
                : "—",
            ],
            [
              "Worker",
              status?.worker?.online
                ? `online · ${
                    status?.worker?.lastTickAt
                      ? new Date(status.worker.lastTickAt).toLocaleTimeString()
                      : "…"
                  }`
                : status?.worker?.lastTickAt
                  ? `stale · ${new Date(status.worker.lastTickAt).toLocaleTimeString()}`
                  : "offline",
            ],
          ].map(([k, v]) => (
            <div
              key={k}
              className="rounded-xl border border-white/10 bg-black/30 p-3"
            >
              <div className="text-[10px] uppercase text-white/40">{k}</div>
              <div
                className={`mt-1 font-mono text-sm ${
                  k === "Worker"
                    ? status?.worker?.online
                      ? "text-emerald-300"
                      : "text-amber-200"
                    : "text-white/90"
                }`}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
        {status?.agentEvm && (
          <p className="mt-3 font-mono text-[11px] text-white/40">
            Agent EOA: {status.agentEvm}
            {status?.worker?.host ? ` · host: ${status.worker.host}` : ""}
          </p>
        )}
        {!status?.worker?.online && (
          <p className="mt-2 text-[11px] text-amber-200/80">
            Worker offline — open this page a moment (status poll starts the
            Vercel tick) or run <code className="text-white/50">npm run worker</code>{" "}
            locally. Hobby plan: daily cron + live ticks while the dashboard is
            open.
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

      <div className="glass flex max-h-[min(52vh,420px)] flex-col overflow-hidden p-5">
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#c8ff4a]">
              Activity history
            </h3>
            <p className="mt-0.5 text-[10px] text-white/35">
              Scrollable · delete only dry-run / failed · executed kept
            </p>
          </div>
          <button
            type="button"
            disabled={deletableCount === 0 || deleting != null}
            onClick={() => void clearDeletable()}
            className="rounded-lg border border-white/15 bg-black/30 px-2.5 py-1 text-[10px] font-medium text-white/55 transition hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
            title="Remove failed / legacy history rows (executed txs stay)"
          >
            {deleting === "bulk"
              ? "Clearing…"
              : `Clear failed${deletableCount ? ` (${deletableCount})` : ""}`}
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
          {actions.length === 0 && (
            <li className="text-sm text-white/40">
              No actions yet — start the worker and create a scheduled send /
              swap.
            </li>
          )}
          {actions.map((a) => {
            const hasTx =
              Boolean(a.txHash) &&
              a.txHash!.startsWith("0x") &&
              a.txHash!.length >= 66;
            const explorer = hasTx
              ? explorerTxUrl(a.chainId, a.txHash!)
              : null;
            const canDelete = DELETABLE_STATUSES.has(a.status);
            return (
              <li
                key={a.id}
                className="rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-white/80">{a.summary}</p>
                    <p className="mt-0.5 text-[10px] text-white/35">
                      {chainLabel(a.chainId)} · {a.type}
                      {a.createdAt
                        ? ` · ${new Date(a.createdAt).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        STATUS_CLS[a.status] || "bg-white/10 text-white/50"
                      }`}
                    >
                      {a.status}
                    </span>
                    {canDelete && (
                      <button
                        type="button"
                        disabled={deleting != null}
                        onClick={() => void deleteAction(a.id)}
                        className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-40"
                        title="Delete this dry-run or failed entry"
                      >
                        {deleting === a.id ? "…" : "Delete"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Transaction hash — verify on explorer */}
                {hasTx && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-950/30 px-2.5 py-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-emerald-200/70">
                      Tx hash
                    </span>
                    <code className="break-all font-mono text-[11px] text-emerald-100/90">
                      {shortHash(a.txHash!, 8)}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyHash(a.txHash!)}
                      className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] text-white/60 hover:bg-white/5 hover:text-white/90"
                    >
                      {copied === a.txHash ? "Copied" : "Copy"}
                    </button>
                    {explorer && (
                      <a
                        href={explorer}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md bg-[#c8ff4a]/90 px-2 py-0.5 text-[10px] font-semibold text-black hover:bg-[#d4ff6a]"
                      >
                        Open explorer ↗
                      </a>
                    )}
                    <details className="w-full">
                      <summary className="cursor-pointer text-[10px] text-white/35 hover:text-white/55">
                        Full hash
                      </summary>
                      <code className="mt-1 block break-all font-mono text-[10px] text-white/55">
                        {a.txHash}
                      </code>
                    </details>
                  </div>
                )}

                {a.status === "executed" && !hasTx && (
                  <p className="mt-2 text-[10px] text-amber-200/70">
                    Status executed but no tx hash stored — check worker logs.
                  </p>
                )}

                {a.error && (
                  <p className="mt-2 break-words text-[10px] text-rose-300/80">
                    {a.error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
