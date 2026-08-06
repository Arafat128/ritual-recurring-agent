import { prisma } from "@rra/core";
import { ensureDb } from "@/lib/server";
import { persistDurableState } from "@/lib/durableState";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  await ensureDb();
  const body = (await req.json()) as { status?: string };
  if (!body.status || !["active", "paused"].includes(body.status)) {
    return Response.json({ error: "status active|paused" }, { status: 400 });
  }
  const rule = await prisma.rule.update({
    where: { id: params.id },
    data: { status: body.status },
  });
  await persistDurableState();
  return Response.json(rule);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  await ensureDb();
  await prisma.rule.delete({ where: { id: params.id } });
  await persistDurableState();
  return Response.json({ ok: true });
}
