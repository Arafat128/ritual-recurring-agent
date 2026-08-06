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
  const [account, setAccount] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [sched, setSched] = useState<Sched>(defaultSched);
  const [busy, setBusy] = useState(false);
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupTx, setTopupTx] = useState("");
  const [topupAmount, setTopupAmount] = useState("0.01");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const load = () => {
    api("/api/rules")
      .then(async (r) => {
        if (!r.ok) {
          setRules([]);
          return;
        }
        setRules(await r.json());
      })
      .catch(() => {});
    api("/api/account")
      .then(async (r) => {
        if (r.ok) setAccount(await r.json());
      })
      .catch(() => {});
  };

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
  const intervalMinutes = useMemo(() => {
    if (form.type !== "scheduled") return null;
    if (sched.freq === "minutes") return Number(sched.everyMin) || 5;
    if (sched.freq === "hours") return (Number(sched.everyHr) || 6) * 60;
    return 24 * 60;
  }, [form.type, sched]);

  useEffect(() => {
    const q = new URLSearchParams({
      type: form.type,
      action: form.action,
    });
    if (intervalMinutes != null) q.set("intervalMinutes", String(intervalMinutes));
    api(`/api/fees/quote?${q}`)
      .then((r) => r.json())
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [form.type, form.action, intervalMinutes]);

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
      if (!res.ok) {
        const hint = data.hint ? ` — ${data.hint}` : "";
        throw new Error((data.error || "failed") + hint);
      }
      setOk(
        `Rule created · ${data.type} ${data.action}` +
          (data.feeChargedEth ? ` · charged ${data.feeChargedEth} RITUAL` : ""),
      );
      setForm(emptyForm);
      load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function topUp() {
    setTopupBusy(true);
    setErr("");
    setOk("");
    try {
      const eth = (window as unknown as { ethereum?: any }).ethereum;
      if (!eth) throw new Error("No wallet");
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const from = accounts[0];
      const to = account?.feeRecipient || config?.fees?.feeRecipient;
      if (!to) {
        throw new Error(
          "Fee recipient not configured — operator must set FEE_RECIPIENT or start the worker",
        );
      }
      const chainIdHex = (await eth.request({ method: "eth_chainId" })) as string;
      if (Number(chainIdHex) !== 1979) {
        throw new Error("Switch to Ritual Testnet (1979) to pay fees in RITUAL");
      }
      const valueEth = topupAmount || "0.01";
      // eth value as hex wei
      const wei = BigInt(Math.floor(Number(valueEth) * 1e18));
      const hash = (await eth.request({
        method: "eth_sendTransaction",
        params: [
          {
            from,
            to,
            value: `0x${wei.toString(16)}`,
          },
        ],
      })) as string;
      setTopupTx(hash);
      // Wait a few seconds then credit
      await new Promise((r) => setTimeout(r, 4000));
      const res = await api("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Credit failed");
      setOk(`Top-up credited · +${data.creditedEth} RITUAL · balance ${data.creditEth}`);
      load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Top-up failed");
    } finally {
      setTopupBusy(false);
    }
  }

  async function creditExistingTx() {
    if (!topupTx.trim()) return;
    setTopupBusy(true);
    setErr("");
    try {
      const res = await api("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: topupTx.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Credit failed");
      setOk(`Credited · +${data.creditedEth} RITUAL · balance ${data.creditEth}`);
      load();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Credit failed");
    } finally {
      setTopupBusy(false);
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

  const feeTo = account?.feeRecipient || config?.fees?.feeRecipient;

  return (
    <div className="space-y-6">
      <div className="glass space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#c8ff4a]">
              Your RITUAL credit
            </h2>
            <p className="mt-1 text-[11px] text-white/45">
              Prepaid balance pays <b className="text-white/70">create</b> +{" "}
              <b className="text-white/70">run</b> fees. A shared operator burner
              executes your rules. Top up by sending RITUAL on chain{" "}
              <b className="text-white/70">1979</b> to the fee recipient.
            </p>
          </div>
          <div className="rounded-xl border border-[#c8ff4a]/25 bg-[#c8ff4a]/5 px-4 py-2 text-right">
            <div className="text-[10px] uppercase tracking-wide text-white/40">
              Balance
            </div>
            <div className="font-mono text-lg text-[#c8ff4a]">
              {account?.creditEth != null
                ? `${Number(account.creditEth).toFixed(5)} RIT`
                : "—"}
            </div>
          </div>
        </div>
        {feeTo && (
          <p className="break-all font-mono text-[10px] text-cyan-200/80">
            Fee recipient: {feeTo}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-[11px] text-white/45">
            Top-up amount (RITUAL)
            <input
              className="input mt-1 w-32"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={topupBusy || !feeTo}
            onClick={() => void topUp()}
          >
            {topupBusy ? "…" : "Pay & credit"}
          </button>
          <label className="block min-w-[12rem] flex-1 text-[11px] text-white/45">
            Or paste tx hash
            <input
              className="input mt-1 font-mono text-xs"
              placeholder="0x…"
              value={topupTx}
              onChange={(e) => setTopupTx(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={topupBusy || !topupTx.trim()}
            onClick={() => void creditExistingTx()}
          >
            Credit tx
          </button>
        </div>
      </div>

    <div className="grid gap-6 lg:grid-cols-5">
      <form onSubmit={submit} className="glass space-y-3 p-5 lg:col-span-2">
        <h2 className="text-lg font-semibold text-[#c8ff4a]">New rule</h2>
        <p className="text-[11px] text-white/40">
          Charged from your prepaid credit. Shared burner executes. Preview:{" "}
          <b className="text-white/60">{preview}</b>
        </p>
        {quote && (
          <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-white/55">
            Create fee:{" "}
            <b className="text-[#c8ff4a]">{quote.createFeeEth} RITUAL</b>
            {" · "}
            Each run:{" "}
            <b className="text-cyan-200/90">{quote.runFeeEth} RITUAL</b>
          </div>
        )}

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
    </div>
  );
}
