/**
 * Multi-tenant fee schedule (RITUAL wei).
 * Users prepay credit; create + each run debit the shared operator ledger.
 * Shared burner (AGENT_PRIVATE_KEY) executes on-chain actions.
 */

import { parseEther, formatEther } from "viem";

function envWei(name: string, fallbackEth: string): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return parseEther(fallbackEth);
  if (/^\d+$/.test(raw)) return BigInt(raw);
  try {
    return parseEther(raw);
  } catch {
    return parseEther(fallbackEth);
  }
}

/** Base create fee for any rule */
export function feeCreateBaseWei(): bigint {
  return envWei("FEE_CREATE_BASE_ETH", "0.001");
}

/** Extra for scheduled / limit_order (recurring work) */
export function feeCreateRecurringWei(): bigint {
  return envWei("FEE_CREATE_RECURRING_ETH", "0.002");
}

/** Extra by action type */
export function feeCreateActionWei(action: string): bigint {
  switch (action) {
    case "ritual_ping":
      return envWei("FEE_CREATE_PING_ETH", "0.0005");
    case "send":
      return envWei("FEE_CREATE_SEND_ETH", "0.001");
    case "swap":
      return envWei("FEE_CREATE_SWAP_ETH", "0.003");
    case "bridge":
      return envWei("FEE_CREATE_BRIDGE_ETH", "0.004");
    default:
      return feeCreateBaseWei();
  }
}

/** Per successful worker execution */
export function feeRunWei(action: string): bigint {
  switch (action) {
    case "ritual_ping":
      return envWei("FEE_RUN_PING_ETH", "0.0002");
    case "send":
      return envWei("FEE_RUN_SEND_ETH", "0.0005");
    case "swap":
      return envWei("FEE_RUN_SWAP_ETH", "0.001");
    case "bridge":
      return envWei("FEE_RUN_BRIDGE_ETH", "0.0015");
    default:
      return envWei("FEE_RUN_DEFAULT_ETH", "0.0005");
  }
}

export type FeeQuoteInput = {
  type: string;
  action: string;
  /** scheduled interval in minutes (approx); used for uplift */
  intervalMinutes?: number | null;
};

export type FeeQuote = {
  createFeeWei: string;
  createFeeEth: string;
  runFeeWei: string;
  runFeeEth: string;
  breakdown: { label: string; wei: string; eth: string }[];
};

export function quoteRuleFees(input: FeeQuoteInput): FeeQuote {
  const parts: { label: string; wei: bigint }[] = [];
  const base = feeCreateBaseWei();
  parts.push({ label: "Base create", wei: base });

  let create = base;
  if (input.type === "scheduled" || input.type === "limit_order") {
    const rec = feeCreateRecurringWei();
    create += rec;
    parts.push({ label: "Recurring rule", wei: rec });
  }
  const act = feeCreateActionWei(input.action);
  create += act;
  parts.push({ label: `Action (${input.action})`, wei: act });

  const mins = input.intervalMinutes ?? null;
  if (mins != null && mins > 0 && mins < 60) {
    // Sub-hourly schedules cost more (more worker load)
    const uplift = feeCreateBaseWei() / BigInt(2);
    create += uplift;
    parts.push({ label: "High-frequency (<1h)", wei: uplift });
  }

  const run = feeRunWei(input.action);
  return {
    createFeeWei: create.toString(),
    createFeeEth: formatEther(create),
    runFeeWei: run.toString(),
    runFeeEth: formatEther(run),
    breakdown: parts.map((p) => ({
      label: p.label,
      wei: p.wei.toString(),
      eth: formatEther(p.wei),
    })),
  };
}

export function feeRecipientAddress(): string | null {
  const a =
    process.env.FEE_RECIPIENT ||
    process.env.NEXT_PUBLIC_FEE_RECIPIENT ||
    process.env.OWNER_ADDRESS ||
    "";
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return a.toLowerCase();
  return null;
}

export function publicFeeConfig() {
  return {
    createBaseEth: formatEther(feeCreateBaseWei()),
    createRecurringEth: formatEther(feeCreateRecurringWei()),
    runPingEth: formatEther(feeRunWei("ritual_ping")),
    runSendEth: formatEther(feeRunWei("send")),
    runSwapEth: formatEther(feeRunWei("swap")),
    runBridgeEth: formatEther(feeRunWei("bridge")),
    feeRecipient: feeRecipientAddress(),
    currency: "RITUAL",
    chainId: 1979,
  };
}
