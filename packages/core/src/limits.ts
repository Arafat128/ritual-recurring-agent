import { getSetting, setSetting } from "./db.js";
import { APP_LIMITS, WORKER } from "./config.js";

const KEY_MAX_TX_USD = "limits.maxTxUsd";
const KEY_MAX_TX_PER_DAY = "limits.maxTxPerDay";
const KEY_LOOP_MS = "worker.loopIntervalMs";

export type AppLimits = {
  maxTxUsd: number;
  maxTxPerDay: number;
  /** Worker poll interval in milliseconds */
  loopIntervalMs: number;
};

export type AppLimitsPatch = {
  maxTxUsd?: number;
  maxTxPerDay?: number;
  loopIntervalMs?: number;
};

function envDefaults(): AppLimits {
  return {
    maxTxUsd: APP_LIMITS.maxTxUsd,
    maxTxPerDay: APP_LIMITS.maxTxPerDay,
    loopIntervalMs: WORKER.loopIntervalMs,
  };
}

function parseNum(raw: string | null, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Effective limits: DB values win when set; else .env / code defaults. */
export async function getAppLimits(): Promise<AppLimits> {
  const env = envDefaults();
  try {
    const [usd, day, loop] = await Promise.all([
      getSetting(KEY_MAX_TX_USD),
      getSetting(KEY_MAX_TX_PER_DAY),
      getSetting(KEY_LOOP_MS),
    ]);
    return {
      maxTxUsd: parseNum(usd, env.maxTxUsd),
      maxTxPerDay: Math.floor(parseNum(day, env.maxTxPerDay)),
      loopIntervalMs: Math.floor(parseNum(loop, env.loopIntervalMs)),
    };
  } catch {
    return env;
  }
}

export function validateLimitsPatch(patch: AppLimitsPatch): string | null {
  if (patch.maxTxUsd !== undefined) {
    if (!Number.isFinite(patch.maxTxUsd) || patch.maxTxUsd < 0.01 || patch.maxTxUsd > 1_000_000) {
      return "maxTxUsd must be between 0.01 and 1,000,000";
    }
  }
  if (patch.maxTxPerDay !== undefined) {
    if (
      !Number.isFinite(patch.maxTxPerDay) ||
      !Number.isInteger(patch.maxTxPerDay) ||
      patch.maxTxPerDay < 1 ||
      patch.maxTxPerDay > 10_000
    ) {
      return "maxTxPerDay must be an integer between 1 and 10,000";
    }
  }
  if (patch.loopIntervalMs !== undefined) {
    if (
      !Number.isFinite(patch.loopIntervalMs) ||
      !Number.isInteger(patch.loopIntervalMs) ||
      patch.loopIntervalMs < 10_000 ||
      patch.loopIntervalMs > 600_000
    ) {
      return "loopIntervalMs must be an integer between 10000 (10s) and 600000 (10m)";
    }
  }
  return null;
}

/** Persist partial limits to DB. Returns full effective limits after update. */
export async function setAppLimits(patch: AppLimitsPatch): Promise<AppLimits> {
  const err = validateLimitsPatch(patch);
  if (err) throw new Error(err);

  if (patch.maxTxUsd !== undefined) {
    await setSetting(KEY_MAX_TX_USD, String(patch.maxTxUsd));
  }
  if (patch.maxTxPerDay !== undefined) {
    await setSetting(KEY_MAX_TX_PER_DAY, String(Math.floor(patch.maxTxPerDay)));
  }
  if (patch.loopIntervalMs !== undefined) {
    await setSetting(KEY_LOOP_MS, String(Math.floor(patch.loopIntervalMs)));
  }
  return getAppLimits();
}
