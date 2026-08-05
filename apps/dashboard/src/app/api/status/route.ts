import { prisma, getSetting, getDryRun, getAppLimits } from "@rra/core";
import { ensureDb } from "@/lib/server";

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
  const [rules, actions, agent, lastTick, started, dryRun, limits, actionsToday] =
    await Promise.all([
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
    ]);
  const active = rules.filter((r) => r.status === "active").length;
  return Response.json({
    dryRun,
    agentEvm: agent,
    worker: { lastTickAt: lastTick, startedAt: started },
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
