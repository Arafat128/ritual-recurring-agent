import {
  prisma,
  getSetting,
  getAppLimits,
  getCreditWei,
  formatEther,
  resolveFeeRecipient,
} from "@rra/core";
import { ensureDb } from "@/lib/server";
import { ensureWorkerTick } from "@/lib/ensureWorkerTick";
import { readWorkerCache, workerIsOnline } from "@/lib/workerCache";
import { isAdmin, requireUser, unauthorizedJson } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export async function GET(req: Request) {
  await ensureDb();
  const auth = await requireUser(req);
  if (!auth.ok) return unauthorizedJson(auth);

  let tickMeta: { triggered: boolean } = { triggered: false };
  try {
    tickMeta = await ensureWorkerTick();
  } catch (e) {
    console.warn("[status] ensureWorkerTick", e);
  }

  const since = startOfUtcDay();
  const admin = await isAdmin(auth.address);
  const ownerFilter = admin ? {} : { ownerAddress: auth.address };

  const [
    rules,
    actions,
    agentDb,
    lastTickDb,
    startedDb,
    limits,
    actionsToday,
    host,
    cached,
    creditWei,
    feeRecipient,
  ] = await Promise.all([
    prisma.rule.findMany({
      where: ownerFilter,
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.action.findMany({
      where: ownerFilter,
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    getSetting("agent.evm"),
    getSetting("worker.lastTickAt"),
    getSetting("worker.startedAt"),
    getAppLimits(),
    prisma.action.count({
      where: {
        status: "executed",
        createdAt: { gte: since },
        ...(admin ? {} : { ownerAddress: auth.address }),
      },
    }),
    getSetting("worker.host"),
    readWorkerCache(),
    getCreditWei(auth.address),
    resolveFeeRecipient(),
  ]);

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
    live: true,
    multiTenant: true,
    isAdmin: admin,
    userAddress: auth.address,
    agentEvm: agent,
    feeRecipient,
    creditWei: creditWei.toString(),
    creditEth: formatEther(creditWei),
    worker: {
      lastTickAt: lastTick,
      startedAt: started,
      online,
      host: host || (process.env.VERCEL ? "vercel" : "local"),
      mode: cached?.mode ?? null,
      tickOnStatus: tickMeta.triggered,
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
