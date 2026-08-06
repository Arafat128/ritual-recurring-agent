import {
  buildLoginMessage,
  encodeSession,
  isAdmin,
  isAllowedOwner,
  normalizeAddress,
  sessionCookieHeader,
  verifyLoginSignature,
} from "@/lib/auth";
import { ensureDb } from "@/lib/server";
import { ensureAccount, getSetting } from "@rra/core";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureDb();
  let body: {
    address?: string;
    signature?: string;
    message?: string;
    nonce?: string;
    chainId?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }

  const address = body.address ? normalizeAddress(body.address) : "";
  const signature = body.signature || "";
  const nonce = body.nonce || "";
  const message = body.message || "";

  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }
  if (!signature || !nonce || !message) {
    return Response.json(
      { error: "address, signature, message, nonce required" },
      { status: 400 },
    );
  }

  const verified = await verifyLoginSignature({
    address,
    signature,
    message,
    nonce,
  });
  if (!verified.ok) {
    return Response.json({ error: verified.error }, { status: 401 });
  }

  // Multi-tenant: any verified wallet is a user
  if (!(await isAllowedOwner(address))) {
    return Response.json(
      {
        ok: false,
        authenticated: false,
        authorized: false,
        address,
        error: "Invalid wallet address",
      },
      { status: 403 },
    );
  }

  await ensureAccount(address).catch(() => undefined);
  const agentEvm = (await getSetting("agent.evm")) || null;
  const admin = await isAdmin(address);

  const token = encodeSession(address);
  return new Response(
    JSON.stringify({
      ok: true,
      authenticated: true,
      authorized: true,
      isAdmin: admin,
      address,
      agentEvm,
      role: admin ? "admin" : "user",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": sessionCookieHeader(token),
      },
    },
  );
}

export async function PUT(req: Request) {
  let body: { address?: string; nonce?: string; chainId?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON body required" }, { status: 400 });
  }
  if (!body.address || !body.nonce) {
    return Response.json({ error: "address and nonce required" }, { status: 400 });
  }
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "localhost";
  const message = buildLoginMessage({
    address: body.address,
    nonce: body.nonce,
    domain: host,
    chainId: body.chainId,
  });
  return Response.json({ message });
}
