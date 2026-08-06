import { privateKeyToAccount } from "viem/accounts";
import { prisma, setSetting } from "../db.js";
import { tryAgentPrivateKey } from "../env.js";
import { getAppLimits } from "../limits.js";
import { processRules } from "./processRules.js";
import { notify } from "./notify.js";

export type WorkerTickResult = {
  ok: boolean;
  at: string;
  agentEvm: string | null;
  mode: "full" | "heartbeat-only";
  error?: string;
  rulesProcessed?: boolean;
};

/**
 * One worker cycle: optional rule processing + heartbeat.
 * Always live execution (no dry-run). Requires AGENT_PRIVATE_KEY for sends.
 */
export async function runWorkerTick(opts?: {
  /** When true, skip rule execution and only write heartbeat */
  heartbeatOnly?: boolean;
}): Promise<WorkerTickResult> {
  const at = new Date().toISOString();

  let key = tryAgentPrivateKey();
  let agentEvm: string | null = key
    ? privateKeyToAccount(key).address
    : await prisma.setting
        .findUnique({ where: { key: "agent.evm" } })
        .then((r) => r?.value ?? null)
        .catch(() => null);

  if (agentEvm) {
    await setSetting("agent.evm", agentEvm);
    try {
      await prisma.user.upsert({
        where: { evmAddress: agentEvm.toLowerCase() },
        create: {
          evmAddress: agentEvm.toLowerCase(),
          label: "ritual-agent",
        },
        update: {},
      });
    } catch {
      /* optional */
    }
  }

  // Clear legacy dry-run flag if present
  try {
    await setSetting("worker.dryRun", "false");
  } catch {
    /* */
  }

  const started = await prisma.setting
    .findUnique({ where: { key: "worker.startedAt" } })
    .then((r) => r?.value)
    .catch(() => null);
  if (!started) {
    await setSetting("worker.startedAt", at);
  }

  let mode: WorkerTickResult["mode"] = "heartbeat-only";
  let rulesProcessed = false;

  if (!opts?.heartbeatOnly && key && agentEvm) {
    mode = "full";
    try {
      await processRules(agentEvm);
      rulesProcessed = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[worker-tick] processRules", msg);
      await setSetting("worker.lastTickAt", at);
      return {
        ok: false,
        at,
        agentEvm,
        mode,
        error: msg,
        rulesProcessed: false,
      };
    }
  } else if (!key) {
    console.warn(
      "[worker-tick] AGENT_PRIVATE_KEY missing; heartbeat only (set a funded burner key for live txs)",
    );
  }

  await setSetting("worker.lastTickAt", at);
  return {
    ok: true,
    at,
    agentEvm,
    mode,
    rulesProcessed,
  };
}

export async function runWorkerStartupNotify(agentEvm: string | null) {
  const limits = await getAppLimits();
  await notify(
    `Ritual Recurring Agent LIVE ${agentEvm ?? "no-key"} · max $${limits.maxTxUsd}/tx · ${limits.maxTxPerDay}/day`,
  );
}
