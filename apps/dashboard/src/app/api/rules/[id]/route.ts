import { prisma } from "@rra/core";
import { ensureEnv } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  ensureEnv();
  const body = (await req.json()) as { status?: string };
  if (!body.status || !["active", "paused"].includes(body.status)) {
    return Response.json({ error: "status active|paused" }, { status: 400 });
  }
  const rule = await prisma.rule.update({
    where: { id: params.id },
    data: { status: body.status },
  });
  return Response.json(rule);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  ensureEnv();
  await prisma.rule.delete({ where: { id: params.id } });
  return Response.json({ ok: true });
}
