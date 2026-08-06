import { prisma } from "@rra/core";
import { ensureDb } from "@/lib/server";
import {
  markRulesDeleted,
  persistDurableState,
} from "@/lib/durableState";
import { requireOwner, unauthorizedJson } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  await ensureDb();
  const auth = await requireOwner(req);
  if (!auth.ok) return unauthorizedJson(auth);

  const id = params.id;
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const body = (await req.json()) as { status?: string };
  if (!body.status || !["active", "paused"].includes(body.status)) {
    return Response.json({ error: "status active|paused" }, { status: 400 });
  }

  try {
    const rule = await prisma.rule.update({
      where: { id },
      data: { status: body.status },
    });
    await persistDurableState();
    return Response.json(rule);
  } catch {
    return Response.json({ error: "Rule not found" }, { status: 404 });
  }
}

/**
 * Idempotent delete:
 * - Works even if this instance never had the row (multi-instance /tmp SQLite)
 * - Tombstones the id so durable restore cannot resurrect it
 * - Detaches related actions (keeps history)
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  await ensureDb();
  const auth = await requireOwner(req);
  if (!auth.ok) return unauthorizedJson(auth);

  const id = params.id;
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  try {
    // Keep activity history; drop FK so rule row can go
    await prisma.action.updateMany({
      where: { ruleId: id },
      data: { ruleId: null },
    });

    const result = await prisma.rule.deleteMany({ where: { id } });

    // Always tombstone + persist — even if count was 0 on this instance
    markRulesDeleted(id);
    await persistDurableState({ deletedRuleIds: [id] });

    return Response.json({
      ok: true,
      deleted: true,
      id,
      localRows: result.count,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    console.error("[rules DELETE]", id, msg);
    // Still try to tombstone so UI can recover
    try {
      markRulesDeleted(id);
      await persistDurableState({ deletedRuleIds: [id] });
    } catch {
      /* */
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
