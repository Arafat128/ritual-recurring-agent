import { getSetting, prisma, runWorkerTick, setSetting } from "@rra/core";
import { persistDurableState } from "@/lib/durableState";
import { writeWorkerCache, workerIsOnline } from "@/lib/workerCache";

/**
 * Hobby-compatible worker keep-alive.
 * Vercel Hobby only allows 1 cron/day, so we also tick when the dashboard
 * polls /api/status and the last heartbeat is stale — OR when active rules
 * are waiting (instant rules must not wait on a "fresh" empty tick).
 */
let inflight: Promise<void> | null = null;

const STALE_MS = 25_000;

export async function ensureWorkerTick(opts?: {
  /** Force a tick even if recent */
  force?: boolean;
}): Promise<{ triggered: boolean; online: boolean; lastTickAt: string | null }> {
  const last = await getSetting("worker.lastTickAt");
  const now = new Date();
  // Instant rules always need a tick; scheduled only when due
  const needsWork = await prisma.rule
    .count({
      where: {
        status: "active",
        OR: [
          { type: "instant" },
          { type: "limit_order" },
          { type: "scheduled", nextRunAt: { lte: now } },
          { type: "scheduled", nextRunAt: null },
        ],
      },
    })
    .catch(() => 0);

  const fresh =
    last &&
    Date.now() - new Date(last).getTime() < STALE_MS &&
    !opts?.force &&
    needsWork === 0;

  if (fresh) {
    return { triggered: false, online: workerIsOnline(last), lastTickAt: last };
  }

  if (inflight) {
    await inflight.catch(() => {});
    const after = await getSetting("worker.lastTickAt");
    return {
      triggered: false,
      online: workerIsOnline(after),
      lastTickAt: after,
    };
  }

  inflight = (async () => {
    try {
      await setSetting("worker.host", process.env.VERCEL ? "vercel" : "local");
      const result = await runWorkerTick();
      await writeWorkerCache({
        lastTickAt: result.at,
        startedAt: (await getSetting("worker.startedAt")) || result.at,
        agentEvm: result.agentEvm,
        mode: result.mode,
      });
      // Publish rule/action changes so other instances see executed txs
      await persistDurableState();
    } catch (e) {
      console.error("[ensureWorkerTick]", e);
      const at = new Date().toISOString();
      try {
        await setSetting("worker.lastTickAt", at);
        await writeWorkerCache({ lastTickAt: at, mode: "error" });
        await persistDurableState();
      } catch {
        /* */
      }
    } finally {
      inflight = null;
    }
  })();

  await inflight;
  const after = await getSetting("worker.lastTickAt");
  return {
    triggered: true,
    online: workerIsOnline(after),
    lastTickAt: after,
  };
}
