import {
  getAdminAddresses,
  getSessionFromRequest,
  isAdmin,
  isAllowedOwner,
  normalizeAddress,
} from "@/lib/auth";
import { ensureDb } from "@/lib/server";
import { getCreditWei, getSetting, resolveFeeRecipient } from "@rra/core";
import { formatEther } from "viem";

export const dynamic = "force-dynamic";

/**
 * Public session probe — never returns other users' rules/history.
 */
export async function GET(req: Request) {
  await ensureDb();
  const session = getSessionFromRequest(req);
  const agentEvm = (await getSetting("agent.evm")) || null;
  const feeRecipient = await resolveFeeRecipient();
  const admins = await getAdminAddresses();

  if (!session) {
    return Response.json({
      authenticated: false,
      authorized: false,
      isAdmin: false,
      address: null,
      agentEvm,
      feeRecipient,
      adminCount: admins.length,
      multiTenant: true,
    });
  }

  const authorized = await isAllowedOwner(session.address);
  const admin = authorized ? await isAdmin(session.address) : false;
  let creditWei = "0";
  let creditEth = "0";
  if (authorized) {
    try {
      const c = await getCreditWei(session.address);
      creditWei = c.toString();
      creditEth = formatEther(c);
    } catch {
      /* */
    }
  }

  return Response.json({
    authenticated: true,
    authorized,
    isAdmin: admin,
    address: normalizeAddress(session.address),
    agentEvm,
    feeRecipient,
    adminCount: admins.length,
    multiTenant: true,
    creditWei,
    creditEth,
  });
}
