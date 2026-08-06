"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

const WEEKDAYS = [
  { v: "1", label: "Monday" },
  { v: "2", label: "Tuesday" },
  { v: "3", label: "Wednesday" },
  { v: "4", label: "Thursday" },
  { v: "5", label: "Friday" },
  { v: "6", label: "Saturday" },
  { v: "0", label: "Sunday" },
];

type Sched = {
  freq: string;
  time: string;
  everyMin: string;
  everyHr: string;
  weekday: string;
  dom: string;
  custom: string;
};

const defaultSched: Sched = {
  freq: "minutes",
  time: "09:00",
  everyMin: "5",
  everyHr: "6",
  weekday: "1",
  dom: "1",
  custom: "*/5 * * * *",
};

function buildCron(s: Sched): string {
  const [h, m] = (s.time || "09:00").split(":").map((x) => String(parseInt(x, 10)));
  switch (s.freq) {
    case "minutes":
      return `*/${parseInt(s.everyMin, 10) || 5} * * * *`;
    case "hours": {
      const step = Math.min(Math.max(parseInt(s.everyHr, 10) || 6, 1), 23);
      const start = new Date();
      const hours: number[] = [];
      for (let hr = start.getHours(); !hours.includes(hr); hr = (hr + step) % 24)
        hours.push(hr);
      return `${start.getMinutes()} ${hours.sort((a, b) => a - b).join(",")} * * *`;
    }
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${s.weekday}`;
    case "monthly":
      return `${m} ${h} ${parseInt(s.dom, 10) || 1} * *`;
    default:
      return s.custom;
  }
}

function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "invalid schedule";
  const [min, hour, dom, , dow] = parts;
  if (min.startsWith("*/") && hour === "*") return `every ${min.slice(2)} minutes`;
  if (hour.startsWith("*/")) return `every ${hour.slice(2)} hours`;
  if (dom === "*" && dow === "*") return `daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  if (dow !== "*")
    return `weekly ${WEEKDAYS.find((w) => w.v === dow)?.label ?? dow}`;
  return `cron: ${cron}`;
}

const emptyForm = {
  type: "scheduled",
  action: "send",
  chainId: 1979,
  toChainId: 8453,
  tokenIn: "RITUAL",
  tokenOut: "USDC",
  amount: "0.001",
  toAddress: "",
  priceTokenId: "ethereum",
  targetPrice: "",
  direction: "above",
};

export default function RulesPage() {
  const [config, setConfig] = useState<any>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [sched, setSched] = useState<Sched>(defaultSched);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const load = () =>
    api("/api/rules")
      .then(async (r) => {
        if (!r.ok) {
          setRules([]);
          return;
        }
        setRules(await r.json());
      })
      .catch(() => {});

  useEffect(() => {
    api("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const setS = (k: keyof Sched, v: string) =>
    setSched((s) => ({ ...s, [k]: v }));

  const cron = useMemo(() => buildCron(sched), [sched]);
  const chain = config?.chains?.find(
    (c: any) => c.chainId === Number(form.chainId)
  );
  const tokens: string[] =
    config?.tokens?.[String(form.chainId)]?.map((t: any) => t.symbol) ||
    ["ETH"];
  const outTokens: string[] =
    form.action === "bridge"
      ? config?.tokens?.[String(form.toChainId)]?.map((t: any) => t.symbol) ||
        ["ETH"]
      : tokens;

  useEffect(() => {
    const id = Number(form.chainId);
    if (id === 1979) {
      setForm((f) => ({
        ...f,
        tokenIn: "RITUAL",
        action:
          f.action === "swap" || f.action === "bridge" ? "send" : f.action,
      }));
    } else if (id === 11155111) {
      setForm((f) => ({
        ...f,
        tokenIn: f.tokenIn === "RITUAL" ? "ETH" : f.tokenIn || "ETH",
        action: f.action === "bridge" ? "swap" : f.action,
      }));
    } else if (id === 8453) {
      setForm((f) => ({
        ...f,
        tokenIn: f.tokenIn === "RITUAL" ? "ETH" : f.tokenIn || "ETH",
      }));
    }
  }, [form.chainId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const res = await api("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          chainId: Number(form.chainId),
          toChainId:
            form.action === "bridge" ? Number(form.toChainId) : undefined,
          targetPrice: form.targetPrice || null,
          cron: form.type === "scheduled" ? cron : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setOk(`Rule created · ${data.type} ${data.action}`);
      setForm(emptyForm);
      load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setErr("");
    try {
      const res = await api(`/api/rules/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Status update failed");
      // Optimistic + reload
      setRules((list) =>
        list.map((r) => (r.id === id ? { ...r, status } : r)),
      );
      load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Status update failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this rule? Activity history is kept.")) return;
    setErr("");
    setOk("");
    // Optimistic remove so the row disappears immediately
    const prev = rules;
    setRules((list) => list.filter((r) => r.id !== id));
    try {
      const res = await api(`/api/rules/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRules(prev);
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      setOk("Rule deleted");
      // Confirm from server (durable snapshot applied)
      load();
    } catch (ex) {
      setRules(prev);
      setErr(ex instanceof Error ? ex.message : "Delete failed");
    }
  }

  const preview =
    form.type === "scheduled"
      ? describeCron(cron)
      : form.type === "limit_order"
        ? `${form.direction} $${form.targetPrice || "?"} (${form.priceTokenId})`
        : "fires once on next worker tick";

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <form onSubmit={submit} className="glass space-y-3 p-5 lg:col-span-2">
        <h2 className="text-lg font-semibold text-[#c8ff4a]">New rule</h2>
        <p className="text-[11px] text-white/40">
          Recurring agent: schedule send / swap / bridge — same idea as DeFi
          Autopilot. Worker executes. Preview:{" "}
          <b className="text-white/60">{preview}</b>
        </p>

        <label className="block text-[11px] text-white/45">
          When (trigger)
          <select
            className="input mt-1"
            value={form.type}
            onChange={(e) => set("type", e.target.value)}
          >
            <option value="scheduled">Scheduled (recurring)</option>
            <option value="instant">Instant (once)</option>
            <option value="limit_order">Limit order (price)</option>
          </select>
        </label>

        <label className="block text-[11px] text-white/45">
          What (action)
          <select
            className="input mt-1"
            value={form.action}
            onChange={(e) => set("action", e.target.value)}
          >
            <option value="send">Send native</option>
            <option value="swap">Swap</option>
            <option value="bridge">Bridge (Base mainnet → dest)</option>
            <option value="ritual_ping">Ritual ping (audit)</option>
          </select>
        </label>

        <label className="block text-[11px] text-white/45">
          Chain
          <select
            className="input mt-1"
            value={form.chainId}
            onChange={(e) => set("chainId", Number(e.target.value))}
          >
            {(config?.chains || []).map((c: any) => (
              <option key={c.chainId} value={c.chainId}>
                {c.testnet ? "🧪" : "🔴"} {c.name} ({c.chainId})
                {c.allowLiveDefi ? " · live DeFi" : ""}
              </option>
            ))}
          </select>
        </label>

        {form.action === "bridge" && (
          <label className="block text-[11px] text-white/45">
            Destination chain
            <select
              className="input mt-1"
              value={form.toChainId}
              onChange={(e) => set("toChainId", Number(e.target.value))}
            >
              <option value={1}>Ethereum (1)</option>
              <option value={8453}>Base (8453)</option>
              <option value={42161}>Arbitrum (42161)</option>
              <option value={10}>Optimism (10)</option>
            </select>
          </label>
        )}

        {form.action === "send" && (
          <>
            <label className="block text-[11px] text-white/45">
              Amount ({chain?.nativeSymbol || "native"})
              <input
                className="input mt-1"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </label>
            <label className="block text-[11px] text-white/45">
              To address
              <input
                className="input mt-1 font-mono text-xs"
                placeholder="0x…"
                value={form.toAddress}
                onChange={(e) => set("toAddress", e.target.value)}
                required={form.action === "send"}
              />
            </label>
          </>
        )}

        {(form.action === "swap" || form.action === "bridge") && (
          <>
            <label className="block text-[11px] text-white/45">
              Amount in
              <input
                className="input mt-1"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11px] text-white/45">
                Token in
                <select
                  className="input mt-1"
                  value={form.tokenIn}
                  onChange={(e) => set("tokenIn", e.target.value)}
                >
                  {tokens.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] text-white/45">
                Token out
                <select
                  className="input mt-1"
                  value={form.tokenOut}
                  onChange={(e) => set("tokenOut", e.target.value)}
                >
                  {outTokens.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}

        {form.type === "scheduled" && (
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="text-[11px] font-semibold text-cyan-200/90">
              Schedule builder
            </div>
            <select
              className="input"
              value={sched.freq}
              onChange={(e) => setS("freq", e.target.value)}
            >
              <option value="minutes">Every N minutes</option>
              <option value="hours">Every N hours</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom cron</option>
            </select>
            {sched.freq === "minutes" && (
              <input
                className="input"
                type="number"
                min={1}
                value={sched.everyMin}
                onChange={(e) => setS("everyMin", e.target.value)}
              />
            )}
            {sched.freq === "hours" && (
              <input
                className="input"
                type="number"
                min={1}
                max={23}
                value={sched.everyHr}
                onChange={(e) => setS("everyHr", e.target.value)}
              />
            )}
            {(sched.freq === "daily" ||
              sched.freq === "weekly" ||
              sched.freq === "monthly") && (
              <input
                className="input"
                type="time"
                value={sched.time}
                onChange={(e) => setS("time", e.target.value)}
              />
            )}
            {sched.freq === "weekly" && (
              <select
                className="input"
                value={sched.weekday}
                onChange={(e) => setS("weekday", e.target.value)}
              >
                {WEEKDAYS.map((w) => (
                  <option key={w.v} value={w.v}>
                    {w.label}
                  </option>
                ))}
              </select>
            )}
            {sched.freq === "custom" && (
              <input
                className="input font-mono"
                value={sched.custom}
                onChange={(e) => setS("custom", e.target.value)}
              />
            )}
            <p className="font-mono text-[10px] text-white/35">
              {cron} · {describeCron(cron)}
            </p>
          </div>
        )}

        {form.type === "limit_order" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-white/45">
              Direction
              <select
                className="input mt-1"
                value={form.direction}
                onChange={(e) => set("direction", e.target.value)}
              >
                <option value="above">above</option>
                <option value="below">below</option>
              </select>
            </label>
            <label className="block text-[11px] text-white/45">
              Target USD
              <input
                className="input mt-1"
                value={form.targetPrice}
                onChange={(e) => set("targetPrice", e.target.value)}
              />
            </label>
          </div>
        )}

        {err && <p className="text-sm text-rose-300">{err}</p>}
        {ok && <p className="text-sm text-emerald-300">{ok}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Saving…" : "Create rule"}
        </button>
      </form>

      <div className="glass p-5 lg:col-span-3">
        <h3 className="mb-3 text-sm font-semibold text-cyan-200">Your rules</h3>
        <ul className="space-y-2">
          {rules.length === 0 && (
            <li className="text-sm text-white/40">
              No rules yet — create a scheduled send or Sepolia swap.
            </li>
          )}
          {rules.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-white/90">
                  {r.type} · {r.action} · chain {r.chainId}
                  {r.toChainId ? `→${r.toChainId}` : ""}
                </span>
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase text-white/50">
                  {r.status}
                </span>
              </div>
              <p className="mt-1 text-white/50">
                {r.amount} {r.tokenIn || ""}{" "}
                {r.tokenOut ? `→ ${r.tokenOut}` : ""}{" "}
                {r.toAddress ? `to ${r.toAddress.slice(0, 10)}…` : ""}{" "}
                {r.cron ? `· ${r.cron}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.status === "active" ? (
                  <button
                    type="button"
                    className="btn-ghost !px-2 !py-1 text-[10px]"
                    onClick={() => void setStatus(r.id, "paused")}
                  >
                    Pause
                  </button>
                ) : r.status === "paused" ? (
                  <button
                    type="button"
                    className="btn-ghost !px-2 !py-1 text-[10px]"
                    onClick={() => void setStatus(r.id, "active")}
                  >
                    Resume
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 text-[10px] text-rose-200/80"
                  onClick={() => void remove(r.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
