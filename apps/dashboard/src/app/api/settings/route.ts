import { getDryRun, setDryRun, getSetting, isDryRunEnv } from "@rra/core";
import { ensureEnv } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureEnv();
  const dryRun = await getDryRun();
  const agent = await getSetting("agent.evm");
  return Response.json({
    dryRun,
    dryRunEnvDefault: isDryRunEnv(),
    agentEvm: agent,
  });
}

export async function PATCH(req: Request) {
  ensureEnv();
  const body = (await req.json()) as { dryRun?: boolean };
  if (typeof body.dryRun !== "boolean") {
    return Response.json({ error: "dryRun boolean required" }, { status: 400 });
  }
  await setDryRun(body.dryRun);
  return Response.json({ ok: true, dryRun: body.dryRun });
}
