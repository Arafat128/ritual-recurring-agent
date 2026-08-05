import { listChainsPublic, listTokensPublic, APP_LIMITS } from "@rra/core";
import { ensureEnv } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureEnv();
  return Response.json({
    chains: listChainsPublic(),
    tokens: listTokensPublic(),
    limits: APP_LIMITS,
    policy: {
      mainnetDefi: "Base only (8453)",
      ritual: "Testnet 1979 — recurring agent ops, native send, pings",
    },
  });
}
