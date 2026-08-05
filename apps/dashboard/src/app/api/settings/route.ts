import {
  getDryRun,
  setDryRun,
  getSetting,
  isDryRunEnv,
  getAppLimits,
  setAppLimits,
  prisma,
} from "@rra/core";
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
  const [dryRun, agent, limits] = await Promise.all([
    getDryRun(),
    getSetting("agent.evm"),
    getAppLimits(),
  ]);
  const since = startOfUtcDay();
  const actionsToday = await prisma.action.count({
    where: {
      status: { in: ["executed", "dry_run"] },
      createdAt: { gte: since },
    },
  });
  return Response.json({
    dryRun,
    dryRunEnvDefault: isDryRunEnv(),
    agentEvm: agent,
    limits,
    usage: {
      actionsToday,
      dayUtc: since.toISOString().slice(0, 10),
    },
  });
}

type PatchBody = {
  dryRun?: boolean;
  maxTxUsd?: number;
  maxTxPerDay?: number;
  /** Seconds in UI; stored as ms */
  loopIntervalSec?: number;
  loopIntervalMs?: number;
};

export async function PATCH(req: Request) {
  await ensureDb();
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }

  const hasDry = typeof body.dryRun === "boolean";
  const hasLimits =
    body.maxTxUsd !== undefined ||
    body.maxTxPerDay !== undefined ||
    body.loopIntervalSec !== undefined ||
    body.loopIntervalMs !== undefined;

  if (!hasDry && !hasLimits) {
    return Response.json(
      {
        error:
          "Provide dryRun and/or limits (maxTxUsd, maxTxPerDay, loopIntervalSec)",
      },
      { status: 400 },
    );
  }

  const out: Record<string, unknown> = { ok: true };

  if (hasDry) {
    await setDryRun(body.dryRun!);
    out.dryRun = body.dryRun;
  }

  if (hasLimits) {
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
      out.limits = await setAppLimits(patch);
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "invalid limits" },
        { status: 400 },
      );
    }
  } else {
    out.limits = await getAppLimits();
  }

  if (!hasDry) {
    out.dryRun = await getDryRun();
  }

  return Response.json(out);
}
