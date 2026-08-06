import { quoteRuleFees } from "@rra/core";
import { ensureDb } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Public fee quote for a draft rule (no auth required). */
export async function GET(req: Request) {
  await ensureDb();
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "scheduled";
  const action = url.searchParams.get("action") || "ritual_ping";
  const intervalMinutes = url.searchParams.get("intervalMinutes");
  const quote = quoteRuleFees({
    type,
    action,
    intervalMinutes: intervalMinutes != null ? Number(intervalMinutes) : null,
  });
  return Response.json(quote);
}

export async function POST(req: Request) {
  await ensureDb();
  let body: {
    type?: string;
    action?: string;
    intervalMinutes?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const quote = quoteRuleFees({
    type: body.type || "scheduled",
    action: body.action || "ritual_ping",
    intervalMinutes: body.intervalMinutes ?? null,
  });
  return Response.json(quote);
}
