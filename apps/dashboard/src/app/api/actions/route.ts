import { prisma } from "@rra/core";
import { ensureDb } from "@/lib/server";
import { persistDurableState } from "@/lib/durableState";
import { isAdmin, requireUser, unauthorizedJson } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DELETABLE = ["dry_run", "error"] as const;

/**
 * DELETE /api/actions
 * Body:
 *   { id: string }           — delete one action if status is dry_run | error
 *   { clear: "deletable" }   — delete all dry_run + error actions for this user
 */
export async function DELETE(req: Request) {
  await ensureDb();
  const auth = await requireUser(req);
  if (!auth.ok) return unauthorizedJson(auth);

  let body: { id?: string; clear?: string } = {};
  try {
    body = (await req.json()) as { id?: string; clear?: string };
  } catch {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }

  const admin = await isAdmin(auth.address);

  if (body.clear === "deletable") {
    const result = await prisma.action.deleteMany({
      where: {
        status: { in: [...DELETABLE] },
        ...(admin ? {} : { ownerAddress: auth.address }),
      },
    });
    await persistDurableState();
    return Response.json({ ok: true, deleted: result.count });
  }

  if (!body.id || typeof body.id !== "string") {
    return Response.json(
      { error: 'Provide { id } or { clear: "deletable" }' },
      { status: 400 },
    );
  }

  const action = await prisma.action.findUnique({ where: { id: body.id } });
  if (!action) {
    return Response.json({ error: "Action not found" }, { status: 404 });
  }
  if (
    !admin &&
    (action.ownerAddress || "").toLowerCase() !== auth.address.toLowerCase()
  ) {
    return Response.json({ error: "Not your action" }, { status: 403 });
  }
  if (!DELETABLE.includes(action.status as (typeof DELETABLE)[number])) {
    return Response.json(
      {
        error: `Cannot delete status "${action.status}". Only dry_run and error (failed) can be removed.`,
      },
      { status: 403 },
    );
  }

  await prisma.action.delete({ where: { id: body.id } });
  await persistDurableState();
  return Response.json({ ok: true, deleted: 1, id: body.id });
}
