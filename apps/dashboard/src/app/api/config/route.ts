import { listChainsPublic, listTokensPublic } from "@rra/core";

export const dynamic = "force-dynamic";

/** Public catalog only — no limits, history, or agent secrets. */
export async function GET() {
  return Response.json({
    chains: listChainsPublic(),
    tokens: listTokensPublic(),
    policy: {
      mainnetDefi: "Base only (8453)",
      ritual: "Testnet 1979 — recurring agent ops, native send, pings",
      auth: "Connect + sign in with the agent wallet to manage rules",
    },
  });
}
