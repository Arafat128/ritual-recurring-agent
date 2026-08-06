import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, sepolia } from "viem/chains";
import { defineChain } from "viem";
import {
  getChain,
  getRpcUrl,
  RITUAL_CHAIN_ID,
  SEPOLIA_ID,
  BASE_MAINNET_ID,
} from "./config.js";
import { prisma } from "./db.js";
import { agentPrivateKey } from "./env.js";
import { getAppLimits } from "./limits.js";
import type { ExecResult, TxRequest } from "./types.js";

function chainFor(chainId: number) {
  if (chainId === RITUAL_CHAIN_ID) {
    return defineChain({
      id: RITUAL_CHAIN_ID,
      name: "Ritual Testnet",
      nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
      rpcUrls: {
        default: { http: [getRpcUrl(RITUAL_CHAIN_ID)] },
      },
    });
  }
  if (chainId === SEPOLIA_ID) return sepolia;
  if (chainId === BASE_MAINNET_ID) return base;
  throw new Error(`executeAction: unsupported chain ${chainId}`);
}

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

async function checkAppLimits(tx: TxRequest): Promise<string | null> {
  const limits = await getAppLimits();
  if (tx.usdValue > limits.maxTxUsd) {
    return `App limit: $${tx.usdValue.toFixed(2)} > max $${limits.maxTxUsd}/tx`;
  }
  const since = startOfUtcDay();
  const count = await prisma.action.count({
    where: {
      status: "executed",
      createdAt: { gte: since },
    },
  });
  if (count >= limits.maxTxPerDay) {
    return `App limit: ${count} actions today ≥ max ${limits.maxTxPerDay}/day`;
  }
  const chain = getChain(tx.chainId);
  if (
    (tx.actionType === "swap" || tx.actionType === "bridge") &&
    !chain.allowLiveDefi &&
    !chain.testnet
  ) {
    return `Live DeFi not allowed on ${chain.name}`;
  }
  return null;
}

export async function executeAction(tx: TxRequest): Promise<ExecResult> {
  const action = await prisma.action.create({
    data: {
      ruleId: tx.ruleId,
      type: tx.actionType,
      status: "pending",
      chainId: tx.chainId,
      summary: tx.summary,
      usdValue: tx.usdValue,
    },
  });

  const limitErr = await checkAppLimits(tx);
  if (limitErr) {
    await prisma.action.update({
      where: { id: action.id },
      data: { status: "skipped", error: limitErr },
    });
    return { status: "skipped", error: limitErr, actionId: action.id };
  }

  const chain = chainFor(tx.chainId);
  const rpc = getRpcUrl(tx.chainId);
  const account = privateKeyToAccount(agentPrivateKey());
  const value = tx.valueNative ? parseEther(tx.valueNative) : 0n;

  const cmd = [
    `send-tx chain=${tx.chainId}`,
    `to=${tx.to}`,
    `value=${tx.valueNative ?? "0"}`,
    tx.data ? `data=${tx.data.slice(0, 18)}…` : "",
    `from=${account.address}`,
  ]
    .filter(Boolean)
    .join(" ");

  try {
    await prisma.action.update({
      where: { id: action.id },
      data: { status: "executing", command: cmd },
    });

    const wallet = createWalletClient({
      account,
      chain,
      transport: http(rpc, { timeout: 60_000 }),
    });
    const publicClient = createPublicClient({
      chain,
      transport: http(rpc, { timeout: 60_000 }),
    });

    const hash = await wallet.sendTransaction({
      to: tx.to as `0x${string}`,
      value,
      data: (tx.data as Hex | undefined) ?? undefined,
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });
    if (receipt.status !== "success") {
      throw new Error(`tx reverted: ${hash}`);
    }

    await prisma.action.update({
      where: { id: action.id },
      data: { status: "executed", txHash: hash },
    });
    return { status: "executed", txHash: hash, actionId: action.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.action.update({
      where: { id: action.id },
      data: { status: "error", error: msg.slice(0, 500) },
    });
    return { status: "error", error: msg, actionId: action.id };
  }
}
