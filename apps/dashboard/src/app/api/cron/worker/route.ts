import { runWorkerTick, getSetting, setSetting } from "@rra/core";
import { ensureDb } from "@/lib/server";
import { writeWorkerCache } from "@/lib/workerCache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Allow rule evaluation + dry-run path on cron */
export const maxDuration = 60;

/**
 * Vercel Cron entrypoint — runs one agent tick per minute.
 * Secured with CRON_SECRET (Authorization: Bearer …).
 * Also accepts manual trigger with same secret for debugging.
 */
function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  if (secret) {
    if (auth === `Bearer ${secret}`) return true;
    try {
      const url = new URL(req.url);
      if (url.searchParams.get("secret") === secret) return true;
    } catch {
      /* */
    }
    return false;
  }

  // No CRON_SECRET set: allow Vercel platform cron header, or local dev only
  if (isVercelCron) return true;
  if (!process.env.VERCEL) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureDb();

    // Mark host as cron (dashboard UI can show mode)
    const started = await getSetting("worker.startedAt");
    if (!started) {
      await setSetting("worker.startedAt", new Date().toISOString());
    }
    await setSetting("worker.host", "vercel-cron");

    const result = await runWorkerTick();

    await writeWorkerCache({
      lastTickAt: result.at,
      startedAt: (await getSetting("worker.startedAt")) || result.at,
      agentEvm: result.agentEvm,
      dryRun: result.dryRun,
      mode: result.mode,
    });

    return Response.json({
      ok: result.ok,
      worker: {
        online: true,
        lastTickAt: result.at,
        agentEvm: result.agentEvm,
        mode: result.mode,
        dryRun: result.dryRun,
        host: "vercel-cron",
      },
      error: result.error ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/worker]", msg);
    // Still try to write a heartbeat so UI doesn't stay stuck offline forever
    try {
      const at = new Date().toISOString();
      await setSetting("worker.lastTickAt", at);
      await writeWorkerCache({ lastTickAt: at, mode: "error" });
    } catch {
      /* */
    }
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
