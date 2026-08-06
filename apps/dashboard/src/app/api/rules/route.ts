import parser from "cron-parser";
import {
  prisma,
  getChain,
  BASE_MAINNET_ID,
  RITUAL_CHAIN_ID,
  SEPOLIA_ID,
} from "@rra/core";
import { ensureDb } from "@/lib/server";
import { persistDurableState } from "@/lib/durableState";
import { ensureWorkerTick } from "@/lib/ensureWorkerTick";
import { requireOwner, unauthorizedJson } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED = new Set([RITUAL_CHAIN_ID, SEPOLIA_ID, BASE_MAINNET_ID]);

export async function GET(req: Request) {
  await ensureDb();
  const auth = await requireOwner(req);
  if (!auth.ok) return unauthorizedJson(auth);

  const rules = await prisma.rule.findMany({ orderBy: { createdAt: "desc" } });
  // Publish local rules into shared snapshot (fixes pre-fix multi-instance drift)
  if (rules.length > 0) {
    await persistDurableState().catch(() => {});
  }
  return Response.json(rules);
}

export async function POST(req: Request) {
  await ensureDb();
  const auth = await requireOwner(req);
  if (!auth.ok) return unauthorizedJson(auth);

  const body = (await req.json()) as Record<string, unknown>;
  const type = String(body.type || "");
  const action = String(body.action || "");
  const chainId = Number(body.chainId);
  const amount = String(body.amount || "");

  if (!["instant", "scheduled", "limit_order"].includes(type)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (!["send", "swap", "bridge", "ritual_ping"].includes(action)) {
    return Response.json({ error: "invalid action" }, { status: 400 });
  }
  if (!ALLOWED.has(chainId)) {
    return Response.json(
      {
        error: `Only Ritual (${RITUAL_CHAIN_ID}), Sepolia (${SEPOLIA_ID}), or Base (${BASE_MAINNET_ID})`,
      },
      { status: 400 }
    );
  }
  try {
    getChain(chainId);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "bad chain" },
      { status: 400 }
    );
  }

  if (action === "swap" && chainId === RITUAL_CHAIN_ID) {
    return Response.json(
      { error: "Swaps not on Ritual — use Sepolia (demo) or Base mainnet" },
      { status: 400 }
    );
  }
  if (action === "bridge" && chainId !== BASE_MAINNET_ID) {
    return Response.json(
      { error: "Bridges only from Base mainnet in this agent" },
      { status: 400 }
    );
  }
  if (action === "send" && !body.toAddress) {
    return Response.json({ error: "toAddress required" }, { status: 400 });
  }
  if (action !== "ritual_ping" && !amount) {
    return Response.json({ error: "amount required" }, { status: 400 });
  }
  if (action === "bridge" && !body.toChainId) {
    return Response.json({ error: "toChainId required for bridge" }, { status: 400 });
  }

  let nextRunAt: Date | null = null;
  const cron = body.cron ? String(body.cron) : null;
  if (type === "scheduled") {
    if (!cron) {
      return Response.json(
        { error: "cron required for scheduled" },
        { status: 400 }
      );
    }
    try {
      nextRunAt = parser.parseExpression(cron).next().toDate();
    } catch {
      return Response.json({ error: "invalid cron" }, { status: 400 });
    }
  }

  const rule = await prisma.rule.create({
    data: {
      type,
      action,
      chainId,
      amount: amount || "0",
      tokenIn: body.tokenIn ? String(body.tokenIn) : null,
      tokenOut: body.tokenOut ? String(body.tokenOut) : null,
      toAddress: body.toAddress ? String(body.toAddress) : null,
      toChainId:
        body.toChainId != null && body.toChainId !== ""
          ? Number(body.toChainId)
          : null,
      priceTokenId: body.priceTokenId ? String(body.priceTokenId) : null,
      targetPrice:
        body.targetPrice != null && body.targetPrice !== ""
          ? Number(body.targetPrice)
          : null,
      direction: body.direction ? String(body.direction) : null,
      cron,
      nextRunAt,
      status: "active",
    },
  });

  // Share rule across Vercel instances, then execute immediately if instant
  await persistDurableState();
  if (type === "instant") {
    try {
      await ensureWorkerTick({ force: true });
      await persistDurableState();
    } catch (e) {
      console.error("[rules] instant execute", e);
    }
  }

  const fresh = await prisma.rule.findUnique({ where: { id: rule.id } });
  return Response.json(fresh || rule);
}
