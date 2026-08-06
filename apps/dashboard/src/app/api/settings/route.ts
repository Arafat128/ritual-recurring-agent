import { getSetting, getAppLimits, setAppLimits, prisma } from "@rra/core";
import { ensureDb } from "@/lib/server";
import { persistDurableState } from "@/lib/durableState";
import { requireOwner, unauthorizedJson } from "@/lib/auth";

export const dynamic = "force-dynamic";

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export async function GET(req: Request) {
  await ensureDb();
  const auth = await requireOwner(req);
  if (!auth.ok) return unauthorizedJson(auth);

  const [agent, limits] = await Promise.all([
    getSetting("agent.evm"),
    getAppLimits(),
  ]);
  const since = startOfUtcDay();
  const actionsToday = await prisma.action.count({
    where: {
      status: "executed",
      createdAt: { gte: since },
    },
  });
  return Response.json({
    live: true,
    agentEvm: agent,
    limits,
    usage: {
      actionsToday,
      dayUtc: since.toISOString().slice(0, 10),
    },
  });
}

type PatchBody = {
  maxTxUsd?: number;
  maxTxPerDay?: number;
  /** Seconds in UI; stored as ms */
  loopIntervalSec?: number;
  loopIntervalMs?: number;
};

export async function PATCH(req: Request) {
  await ensureDb();
  const auth = await requireOwner(req);
  if (!auth.ok) return unauthorizedJson(auth);

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }

  const hasLimits =
    body.maxTxUsd !== undefined ||
    body.maxTxPerDay !== undefined ||
    body.loopIntervalSec !== undefined ||
    body.loopIntervalMs !== undefined;

  if (!hasLimits) {
    return Response.json(
      {
        error:
          "Provide limits (maxTxUsd, maxTxPerDay, and/or loopIntervalSec)",
      },
      { status: 400 },
    );
  }

  const patch: {
    maxTxUsd?: number;
    maxTxPerDay?: number;
    loopIntervalMs?: number;
  } = {};
  if (body.maxTxUsd !== undefined) patch.maxTxUsd = Number(body.maxTxUsd);
  if (body.maxTxPerDay !== undefined) {
    patch.maxTxPerDay = Math.floor(Number(body.maxTxPerDay));
  }
  if (body.loopIntervalMs !== undefined) {
    patch.loopIntervalMs = Math.floor(Number(body.loopIntervalMs));
  } else if (body.loopIntervalSec !== undefined) {
    patch.loopIntervalMs = Math.floor(Number(body.loopIntervalSec) * 1000);
  }

  try {
    const limits = await setAppLimits(patch);
    await persistDurableState();
    return Response.json({ ok: true, live: true, limits });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "invalid limits" },
      { status: 400 },
    );
  }
}
