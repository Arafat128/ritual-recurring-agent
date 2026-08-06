import {
  applyTopUpFromTx,
  formatEther,
  getCreditWei,
  publicFeeConfig,
  resolveFeeRecipient,
} from "@rra/core";
import { ensureDb } from "@/lib/server";
import { requireUser, unauthorizedJson } from "@/lib/auth";
import { prisma } from "@rra/core";

export const dynamic = "force-dynamic";

/** GET: credit balance + recent payments + fee config */
export async function GET(req: Request) {
  await ensureDb();
  const auth = await requireUser(req);
  if (!auth.ok) return unauthorizedJson(auth);

  const creditWei = await getCreditWei(auth.address);
  const payments = await prisma.payment.findMany({
    where: { address: auth.address },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const feeRecipient = await resolveFeeRecipient();

  return Response.json({
    address: auth.address,
    creditWei: creditWei.toString(),
    creditEth: formatEther(creditWei),
    feeRecipient,
    fees: publicFeeConfig(),
    payments,
  });
}

/**
 * POST: credit a Ritual transfer txHash (top-up).
 * Body: { txHash: "0x..." }
 */
export async function POST(req: Request) {
  await ensureDb();
  const auth = await requireUser(req);
  if (!auth.ok) return unauthorizedJson(auth);

  let body: { txHash?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }
  if (!body.txHash) {
    return Response.json({ error: "txHash required" }, { status: 400 });
  }

  const result = await applyTopUpFromTx({
    address: auth.address,
    txHash: body.txHash,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({
    ok: true,
    creditedEth: result.amountEth,
    creditWei: result.creditWei,
    creditEth: formatEther(BigInt(result.creditWei)),
  });
}
