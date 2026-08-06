import {
  listChainsPublic,
  listTokensPublic,
  publicFeeConfig,
  resolveFeeRecipient,
} from "@rra/core";

export const dynamic = "force-dynamic";

/** Public catalog + multi-tenant policy — no user secrets. */
export async function GET() {
  const feeRecipient = await resolveFeeRecipient();
  return Response.json({
    chains: listChainsPublic(),
    tokens: listTokensPublic(),
    multiTenant: true,
    fees: { ...publicFeeConfig(), feeRecipient },
    policy: {
      mainnetDefi: "Base only (8453)",
      ritual: "Testnet 1979 — native send, pings, fee payments",
      auth: "Connect + sign in with YOUR wallet (any EOA). Rules and history are private to you.",
      execution:
        "A shared operator burner (AGENT_PRIVATE_KEY on the worker) executes due rules. You prepay RITUAL credit for create + run fees.",
      local:
        "See /guide or README for local operator setup (worker + burner + fee recipient).",
    },
  });
}
