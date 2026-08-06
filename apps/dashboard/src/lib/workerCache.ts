/**
 * Cross-instance worker heartbeat for Vercel.
 * SQLite on /tmp is per-instance; Runtime Cache is shared per region.
 */

export type CachedWorkerState = {
  lastTickAt: string;
  startedAt?: string | null;
  agentEvm?: string | null;
  mode?: string;
};

const CACHE_KEY = "rra:worker:heartbeat";

export async function writeWorkerCache(
  state: CachedWorkerState
): Promise<void> {
  if (!process.env.VERCEL) return;
  try {
    const { getCache } = await import("@vercel/functions");
    const cache = getCache();
    await cache.set(CACHE_KEY, state, {
      ttl: 300, // 5 minutes
      tags: ["rra-worker"],
    });
  } catch (e) {
    console.warn("[workerCache] write failed", e);
  }
}

export async function readWorkerCache(): Promise<CachedWorkerState | null> {
  if (!process.env.VERCEL) return null;
  try {
    const { getCache } = await import("@vercel/functions");
    const cache = getCache();
    const v = (await cache.get(CACHE_KEY)) as CachedWorkerState | null;
    return v ?? null;
  } catch {
    return null;
  }
}

/** Online if last tick within 3 minutes (cron is every 1 min). */
export function workerIsOnline(lastTickAt: string | null | undefined): boolean {
  if (!lastTickAt) return false;
  const t = new Date(lastTickAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 3 * 60_000;
}
