import { listChainsPublic, listTokensPublic, getAppLimits } from "@rra/core";
import { ensureDb } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDb();
  const limits = await getAppLimits();
  return Response.json({
    chains: listChainsPublic(),
    tokens: listTokensPublic(),
    limits,
    policy: {
      mainnetDefi: "Base only (8453)",
      ritual: "Testnet 1979 — recurring agent ops, native send, pings",
    },
  });
}
