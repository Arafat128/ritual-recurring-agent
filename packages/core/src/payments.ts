/**
 * Prepaid credit ledger + Ritual payment verification.
 */

import {
  createPublicClient,
  http,
  parseEther,
  formatEther,
  type Hex,
  type Address,
} from "viem";
import { getRpcUrl, RITUAL_CHAIN_ID } from "./config.js";
import { prisma, getSetting } from "./db.js";
import { feeRecipientAddress } from "./fees.js";

function ritualClient() {
  return createPublicClient({
    transport: http(getRpcUrl(RITUAL_CHAIN_ID), {
      timeout: 20_000,
      retryCount: 1,
    }),
  });
}

export function normalizeAddr(a: string): string {
  return a.trim().toLowerCase();
}

export async function resolveFeeRecipient(): Promise<string | null> {
  const env = feeRecipientAddress();
  if (env) return env;
  const agent = await getSetting("agent.evm");
  if (agent && /^0x[0-9a-fA-F]{40}$/.test(agent)) return agent.toLowerCase();
  return null;
}

export async function getCreditWei(address: string): Promise<bigint> {
  const row = await prisma.account.findUnique({
    where: { address: normalizeAddr(address) },
  });
  if (!row?.creditWei) return BigInt(0);
  try {
    return BigInt(row.creditWei);
  } catch {
    return BigInt(0);
  }
}

export async function ensureAccount(address: string) {
  const a = normalizeAddr(address);
  await prisma.account.upsert({
    where: { address: a },
    create: { address: a, creditWei: "0" },
    update: {},
  });
  await prisma.user.upsert({
    where: { evmAddress: a },
    create: { evmAddress: a, label: "user" },
    update: {},
  });
}

/**
 * Credit user balance (top-up or refund). amountWei must be positive.
 */
export async function creditAccount(opts: {
  address: string;
  amountWei: bigint;
  kind: string;
  txHash?: string | null;
  ruleId?: string | null;
  note?: string | null;
}): Promise<{ creditWei: string }> {
  if (opts.amountWei <= BigInt(0)) throw new Error("amount must be positive");
  const a = normalizeAddr(opts.address);
  await ensureAccount(a);

  if (opts.txHash) {
    const prior = await prisma.payment.findUnique({
      where: { txHash: opts.txHash.toLowerCase() },
    });
    if (prior) {
      const bal = await getCreditWei(a);
      return { creditWei: bal.toString() };
    }
  }

  const bal = await getCreditWei(a);
  const next = bal + opts.amountWei;
  await prisma.account.update({
    where: { address: a },
    data: { creditWei: next.toString() },
  });
  await prisma.payment.create({
    data: {
      address: a,
      kind: opts.kind,
      amountWei: opts.amountWei.toString(),
      txHash: opts.txHash ? opts.txHash.toLowerCase() : null,
      ruleId: opts.ruleId || null,
      note: opts.note || null,
    },
  });
  return { creditWei: next.toString() };
}

/**
 * Debit user credit. Returns false if insufficient.
 */
export async function debitAccount(opts: {
  address: string;
  amountWei: bigint;
  kind: string;
  ruleId?: string | null;
  note?: string | null;
}): Promise<{ ok: true; creditWei: string } | { ok: false; creditWei: string; error: string }> {
  if (opts.amountWei <= BigInt(0)) {
    const bal = await getCreditWei(opts.address);
    return { ok: true, creditWei: bal.toString() };
  }
  const a = normalizeAddr(opts.address);
  await ensureAccount(a);
  const bal = await getCreditWei(a);
  if (bal < opts.amountWei) {
    return {
      ok: false,
      creditWei: bal.toString(),
      error: `Insufficient credit: have ${formatEther(bal)} RITUAL, need ${formatEther(opts.amountWei)}`,
    };
  }
  const next = bal - opts.amountWei;
  await prisma.account.update({
    where: { address: a },
    data: { creditWei: next.toString() },
  });
  await prisma.payment.create({
    data: {
      address: a,
      kind: opts.kind,
      amountWei: opts.amountWei.toString(),
      ruleId: opts.ruleId || null,
      note: opts.note || null,
    },
  });
  return { ok: true, creditWei: next.toString() };
}

/**
 * Verify a native RITUAL transfer on Ritual testnet to the fee recipient.
 */
export async function verifyRitualTopUpTx(opts: {
  txHash: string;
  from: string;
  minWei: bigint;
}): Promise<
  | { ok: true; amountWei: bigint; to: string }
  | { ok: false; error: string }
> {
  const hash = opts.txHash.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) {
    return { ok: false, error: "Invalid transaction hash" };
  }
  const prior = await prisma.payment.findUnique({ where: { txHash: hash } });
  if (prior) {
    return { ok: false, error: "This payment tx was already credited" };
  }

  const recipient = await resolveFeeRecipient();
  if (!recipient) {
    return {
      ok: false,
      error:
        "Fee recipient not configured. Operator must set FEE_RECIPIENT or start worker (agent.evm).",
    };
  }

  const client = ritualClient();
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: hash as Hex });
  } catch {
    return { ok: false, error: "Transaction not found on Ritual (still pending?)" };
  }
  if (!receipt || receipt.status !== "success") {
    return { ok: false, error: "Transaction failed or not successful" };
  }

  let tx;
  try {
    tx = await client.getTransaction({ hash: hash as Hex });
  } catch {
    return { ok: false, error: "Could not load transaction" };
  }

  const from = normalizeAddr(tx.from);
  if (from !== normalizeAddr(opts.from)) {
    return { ok: false, error: "Payment must be sent from your signed-in wallet" };
  }
  const to = tx.to ? normalizeAddr(tx.to) : "";
  if (to !== recipient) {
    return {
      ok: false,
      error: `Payment must go to fee recipient ${recipient}`,
    };
  }
  const value = tx.value ?? BigInt(0);
  if (value < opts.minWei) {
    return {
      ok: false,
      error: `Amount too small: sent ${formatEther(value)}, min ${formatEther(opts.minWei)} RITUAL`,
    };
  }

  return { ok: true, amountWei: value, to: recipient };
}

export async function applyTopUpFromTx(opts: {
  address: string;
  txHash: string;
  minWei?: bigint;
}): Promise<
  | { ok: true; creditWei: string; amountWei: string; amountEth: string }
  | { ok: false; error: string }
> {
  const min = opts.minWei ?? parseEther("0.0001");
  const v = await verifyRitualTopUpTx({
    txHash: opts.txHash,
    from: opts.address,
    minWei: min,
  });
  if (!v.ok) return v;
  const { creditWei } = await creditAccount({
    address: opts.address,
    amountWei: v.amountWei,
    kind: "topup",
    txHash: opts.txHash,
    note: `top-up to ${v.to}`,
  });
  return {
    ok: true,
    creditWei,
    amountWei: v.amountWei.toString(),
    amountEth: formatEther(v.amountWei),
  };
}

export { formatEther, parseEther };
