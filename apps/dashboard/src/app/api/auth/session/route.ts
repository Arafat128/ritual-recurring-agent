import {
  getAllowedOwners,
  getSessionFromRequest,
  isAllowedOwner,
  normalizeAddress,
} from "@/lib/auth";
import { ensureDb } from "@/lib/server";
import { getSetting } from "@rra/core";

export const dynamic = "force-dynamic";

/**
 * Public session probe — never returns rules/history.
 * agentEvm is returned so the UI can tell users which wallet to connect.
 */
export async function GET(req: Request) {
  await ensureDb();
  const session = getSessionFromRequest(req);
  const agentEvm = (await getSetting("agent.evm")) || null;
  const owners = await getAllowedOwners();

  if (!session) {
    return Response.json({
      authenticated: false,
      authorized: false,
      address: null,
      agentEvm,
      ownerCount: owners.length,
    });
  }

  const authorized = await isAllowedOwner(session.address);
  return Response.json({
    authenticated: true,
    authorized,
    address: normalizeAddress(session.address),
    agentEvm,
    ownerCount: owners.length,
  });
}
