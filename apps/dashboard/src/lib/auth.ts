/**
 * Multi-layer dashboard auth (SIWE-lite) — multi-tenant.
 *
 * Layer 1: Wallet must cryptographically sign a login message (not spoofable).
 * Layer 2: Session cookie is HttpOnly + HMAC-signed (not forgeable without secret).
 * Layer 3: Any verified wallet is a **user** (owns their own rules/credit).
 * Layer 4: **Admin** = agent EOA and/or OWNER_ADDRESSES (global settings only).
 * Layer 5: Session expires (default 24h).
 * Layer 6: Sensitive APIs refuse unauthenticated callers.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "viem";
import { getSetting } from "@rra/core";

const COOKIE = "rra_session";
const NONCE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 24 * 60 * 60_000;

type SessionPayload = {
  address: string;
  exp: number;
  iat: number;
};

/** Used nonces (replay protection) — memory + Runtime Cache on Vercel */
const usedNonces = new Map<string, number>();

function authSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.CRON_SECRET ||
    process.env.AGENT_PRIVATE_KEY ||
    "dev-only-insecure-rra-auth"
  );
}

function b64url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(payloadB64: string): string {
  return createHmac("sha256", authSecret())
    .update(payloadB64)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

/** Operator / admin wallets: agent EOA + OWNER_ADDRESSES (comma-separated) */
export async function getAdminAddresses(): Promise<string[]> {
  const set = new Set<string>();
  const agent = await getSetting("agent.evm");
  if (agent) set.add(normalizeAddress(agent));

  const envOwners = process.env.OWNER_ADDRESSES || process.env.OWNER_ADDRESS || "";
  for (const part of envOwners.split(",")) {
    const a = part.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(a)) set.add(normalizeAddress(a));
  }
  return Array.from(set);
}

/** @deprecated use getAdminAddresses — kept for older imports */
export async function getAllowedOwners(): Promise<string[]> {
  return getAdminAddresses();
}

/** True if address may manage global operator settings */
export async function isAdmin(address: string | null | undefined): Promise<boolean> {
  if (!address) return false;
  const admins = await getAdminAddresses();
  return admins.includes(normalizeAddress(address));
}

/**
 * Any signed-in wallet is a multi-tenant user.
 * (Historically only the agent EOA was allowed — that blocked public use.)
 */
export async function isAllowedOwner(address: string | null | undefined): Promise<boolean> {
  if (!address) return false;
  return /^0x[0-9a-f]{40}$/.test(normalizeAddress(address));
}

/**
 * Stateless HMAC nonce — works across Vercel instances (no shared memory).
 * Format: `{timestamp}.{random}.{mac16}`
 */
export function createNonce(): string {
  const ts = Date.now().toString();
  const rnd = randomBytes(8).toString("hex");
  const raw = `${ts}.${rnd}`;
  const mac = createHmac("sha256", authSecret())
    .update(raw)
    .digest("hex")
    .slice(0, 16);
  return `${raw}.${mac}`;
}

export async function consumeNonce(nonce: string): Promise<boolean> {
  const parts = nonce.split(".");
  if (parts.length !== 3) return false;
  const [ts, rnd, mac] = parts;
  if (!ts || !rnd || !mac) return false;
  const raw = `${ts}.${rnd}`;
  const expected = createHmac("sha256", authSecret())
    .update(raw)
    .digest("hex")
    .slice(0, 16);
  if (!safeEqual(mac, expected)) return false;

  const t = Number(ts);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  if (t > now + 60_000) return false;
  if (now - t > NONCE_TTL_MS) return false;

  // Replay guard
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, now + NONCE_TTL_MS);
  if (usedNonces.size > 1000) {
    for (const [k, exp] of usedNonces) {
      if (exp < now) usedNonces.delete(k);
    }
  }

  if (process.env.VERCEL) {
    try {
      const { getCache } = await import("@vercel/functions");
      const cache = getCache();
      const key = `rra:nonce:used:${nonce}`;
      const prior = await cache.get(key);
      if (prior) return false;
      await cache.set(key, "1", { ttl: Math.ceil(NONCE_TTL_MS / 1000) });
    } catch {
      /* memory-only replay guard */
    }
  }
  return true;
}

export function buildLoginMessage(opts: {
  address: string;
  nonce: string;
  domain: string;
  chainId?: number;
}): string {
  const issued = new Date().toISOString();
  const chainId = opts.chainId ?? 1979;
  return [
    `${opts.domain} wants you to sign in to Ritual Recurring Agent.`,
    "",
    `Address: ${opts.address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${issued}`,
    "",
    "This signature proves wallet ownership. It does not send a transaction or spend funds.",
  ].join("\n");
}

export async function verifyLoginSignature(opts: {
  address: string;
  message: string;
  signature: string;
  nonce: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await consumeNonce(opts.nonce))) {
    return { ok: false, error: "Invalid or expired nonce — try again" };
  }
  if (!opts.message.includes(`Nonce: ${opts.nonce}`)) {
    return { ok: false, error: "Message nonce mismatch" };
  }
  if (!opts.message.toLowerCase().includes(normalizeAddress(opts.address))) {
    return { ok: false, error: "Message address mismatch" };
  }
  try {
    const valid = await verifyMessage({
      address: opts.address as `0x${string}`,
      message: opts.message,
      signature: opts.signature as `0x${string}`,
    });
    if (!valid) return { ok: false, error: "Invalid signature" };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Signature verification failed",
    };
  }
}

export function encodeSession(address: string): string {
  const now = Date.now();
  const payload: SessionPayload = {
    address: normalizeAddress(address),
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function decodeSession(token: string | undefined | null): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64);
  if (!safeEqual(sig, expected)) return null;
  try {
    const json = fromB64url(payloadB64).toString("utf8");
    const payload = JSON.parse(json) as SessionPayload;
    if (!payload.address || !payload.exp) return null;
    if (payload.exp < Date.now()) return null;
    if (!/^0x[0-9a-f]{40}$/.test(payload.address)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function getSessionFromRequest(req: Request): SessionPayload | null {
  const cookies = parseCookies(req.headers.get("cookie"));
  return decodeSession(cookies[COOKIE] || null);
}

export function sessionCookieHeader(token: string): string {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export type AuthResult =
  | { ok: true; address: string }
  | { ok: false; status: number; error: string; code: string };

/**
 * Require signed-in **user** session (any wallet that completed SIWE).
 */
export async function requireUser(req: Request): Promise<AuthResult> {
  const session = getSessionFromRequest(req);
  if (!session) {
    return {
      ok: false,
      status: 401,
      error: "Sign in with your wallet to continue",
      code: "UNAUTHENTICATED",
    };
  }
  if (!(await isAllowedOwner(session.address))) {
    return {
      ok: false,
      status: 403,
      error: "Invalid session address",
      code: "FORBIDDEN",
    };
  }
  return { ok: true, address: session.address };
}

/** @deprecated alias — multi-tenant users use requireUser */
export async function requireOwner(req: Request): Promise<AuthResult> {
  return requireUser(req);
}

/** Operator-only (agent EOA or OWNER_ADDRESSES) */
export async function requireAdmin(req: Request): Promise<AuthResult> {
  const user = await requireUser(req);
  if (!user.ok) return user;
  if (!(await isAdmin(user.address))) {
    return {
      ok: false,
      status: 403,
      error: "Operator only — admin settings require the agent or OWNER_ADDRESSES wallet",
      code: "FORBIDDEN_ADMIN",
    };
  }
  return user;
}

export function unauthorizedJson(auth: Extract<AuthResult, { ok: false }>) {
  return Response.json(
    { error: auth.error, code: auth.code },
    { status: auth.status },
  );
}

export { COOKIE as SESSION_COOKIE_NAME };
