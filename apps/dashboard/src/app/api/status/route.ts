import { prisma, getSetting, getDryRun } from "@rra/core";
import { ensureEnv } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureEnv();
  const [rules, actions, agent, lastTick, started, dryRun] = await Promise.all([
    prisma.rule.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.action.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    getSetting("agent.evm"),
    getSetting("worker.lastTickAt"),
    getSetting("worker.startedAt"),
    getDryRun(),
  ]);
  const active = rules.filter((r) => r.status === "active").length;
  return Response.json({
    dryRun,
    agentEvm: agent,
    worker: { lastTickAt: lastTick, startedAt: started },
    counts: {
      rules: rules.length,
      active,
      actions: actions.length,
    },
    rules,
    actions,
  });
}
