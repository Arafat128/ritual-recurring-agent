import { getSetting, runWorkerTick, setSetting } from "@rra/core";
import { writeWorkerCache, workerIsOnline } from "@/lib/workerCache";

/**
 * Hobby-compatible worker keep-alive.
 * Vercel Hobby only allows 1 cron/day, so we also tick when the dashboard
 * polls /api/status and the last heartbeat is stale.
 */
let inflight: Promise<void> | null = null;

const STALE_MS = 25_000;

export async function ensureWorkerTick(opts?: {
  /** Force a tick even if recent */
  force?: boolean;
}): Promise<{ triggered: boolean; online: boolean; lastTickAt: string | null }> {
  const last = await getSetting("worker.lastTickAt");
  const fresh =
    last && Date.now() - new Date(last).getTime() < STALE_MS && !opts?.force;

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
        dryRun: result.dryRun,
        mode: result.mode,
      });
    } catch (e) {
      console.error("[ensureWorkerTick]", e);
      const at = new Date().toISOString();
      try {
        await setSetting("worker.lastTickAt", at);
        await writeWorkerCache({ lastTickAt: at, mode: "error" });
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
