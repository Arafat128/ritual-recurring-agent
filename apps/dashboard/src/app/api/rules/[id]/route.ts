import { prisma } from "@rra/core";
import { ensureDb } from "@/lib/server";
import {
  markRulesDeleted,
  persistDurableState,
} from "@/lib/durableState";
import { isAdmin, requireUser, unauthorizedJson } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function loadOwnedRule(id: string, address: string, admin: boolean) {
  const rule = await prisma.rule.findUnique({ where: { id } });
  if (!rule) return null;
  if (admin) return rule;
  if ((rule.ownerAddress || "").toLowerCase() !== address.toLowerCase()) {
    return "forbidden" as const;
  }
  return rule;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  await ensureDb();
  const auth = await requireUser(req);
  if (!auth.ok) return unauthorizedJson(auth);

  const id = params.id;
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const body = (await req.json()) as { status?: string };
  if (!body.status || !["active", "paused"].includes(body.status)) {
    return Response.json({ error: "status active|paused" }, { status: 400 });
  }

  const admin = await isAdmin(auth.address);
  const owned = await loadOwnedRule(id, auth.address, admin);
  if (owned === null) {
    return Response.json({ error: "Rule not found" }, { status: 404 });
  }
  if (owned === "forbidden") {
    return Response.json({ error: "Not your rule" }, { status: 403 });
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

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  await ensureDb();
  const auth = await requireUser(req);
  if (!auth.ok) return unauthorizedJson(auth);

  const id = params.id;
  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const admin = await isAdmin(auth.address);
  const owned = await loadOwnedRule(id, auth.address, admin);
  if (owned === null) {
    // Idempotent tombstone for multi-instance
    markRulesDeleted(id);
    await persistDurableState({ deletedRuleIds: [id] }).catch(() => {});
    return Response.json({ ok: true, deleted: true, id, localRows: 0 });
  }
  if (owned === "forbidden") {
    return Response.json({ error: "Not your rule" }, { status: 403 });
  }

  try {
    await prisma.action.updateMany({
      where: { ruleId: id },
      data: { ruleId: null },
    });

    const result = await prisma.rule.deleteMany({
      where: admin
        ? { id }
        : { id, ownerAddress: auth.address },
    });

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
    try {
      markRulesDeleted(id);
      await persistDurableState({ deletedRuleIds: [id] });
    } catch {
      /* */
    }
    return Response.json({ error: msg }, { status: 500 });
  }
}
