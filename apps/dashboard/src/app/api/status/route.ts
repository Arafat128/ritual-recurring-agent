import { prisma, getSetting, getDryRun, getAppLimits } from "@rra/core";
import { ensureDb } from "@/lib/server";
import { readWorkerCache, workerIsOnline } from "@/lib/workerCache";

export const dynamic = "force-dynamic";

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export async function GET() {
  await ensureDb();
  const since = startOfUtcDay();
  const [
    rules,
    actions,
    agentDb,
    lastTickDb,
    startedDb,
    dryRun,
    limits,
    actionsToday,
    host,
    cached,
  ] = await Promise.all([
    prisma.rule.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.action.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    getSetting("agent.evm"),
    getSetting("worker.lastTickAt"),
    getSetting("worker.startedAt"),
    getDryRun(),
    getAppLimits(),
    prisma.action.count({
      where: {
        status: { in: ["executed", "dry_run"] },
        createdAt: { gte: since },
      },
    }),
    getSetting("worker.host"),
    readWorkerCache(),
  ]);

  // Prefer freshest heartbeat (Runtime Cache spans instances; SQLite is /tmp)
  let lastTick = lastTickDb;
  let started = startedDb;
  let agent = agentDb;
  if (cached?.lastTickAt) {
    if (
      !lastTick ||
      new Date(cached.lastTickAt).getTime() > new Date(lastTick).getTime()
    ) {
      lastTick = cached.lastTickAt;
    }
    if (cached.startedAt) started = cached.startedAt;
    if (cached.agentEvm) agent = cached.agentEvm;
  }

  const online = workerIsOnline(lastTick);
  const active = rules.filter((r) => r.status === "active").length;

  return Response.json({
    dryRun,
    agentEvm: agent,
    worker: {
      lastTickAt: lastTick,
      startedAt: started,
      online,
      host: host || (process.env.VERCEL ? "vercel" : "local"),
      mode: cached?.mode ?? null,
    },
    limits,
    usage: { actionsToday, dayUtc: since.toISOString().slice(0, 10) },
    counts: {
      rules: rules.length,
      active,
      actions: actions.length,
    },
    rules,
    actions,
  });
}
