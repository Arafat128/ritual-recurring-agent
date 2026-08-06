import { createNonce } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const nonce = createNonce();
  return Response.json({
    nonce,
    expiresInSec: 600,
  });
}
