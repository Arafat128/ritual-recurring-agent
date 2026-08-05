import { formatEther } from "viem";
import type { TxRequest } from "../types.js";

const LIFI_BASE = "https://li.quest/v1";

export interface LifiQuoteParams {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
}

export async function getLifiQuote(p: LifiQuoteParams): Promise<{
  tx: Omit<TxRequest, "usdValue" | "summary" | "actionType">;
  estimateUsd: number;
  tool: string;
  approvalAddress?: string;
}> {
  const url = new URL(`${LIFI_BASE}/quote`);
  url.searchParams.set("fromChain", String(p.fromChainId));
  url.searchParams.set("toChain", String(p.toChainId));
  url.searchParams.set("fromToken", p.fromToken);
  url.searchParams.set("toToken", p.toToken);
  url.searchParams.set("fromAmount", p.fromAmount);
  url.searchParams.set("fromAddress", p.fromAddress);

  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.LIFI_API_KEY) headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new Error(`LI.FI quote failed: ${res.status} ${await res.text()}`);
  }
  const quote = (await res.json()) as {
    transactionRequest?: { to?: string; data?: string; value?: string };
    estimate?: { fromAmountUSD?: string; approvalAddress?: string };
    tool?: string;
  };
  const txReq = quote.transactionRequest;
  if (!txReq?.to || !txReq?.data) {
    throw new Error("LI.FI quote missing transactionRequest");
  }

  const valueWei = BigInt(txReq.value ?? "0x0");
  return {
    tx: {
      chainId: p.fromChainId,
      to: txReq.to,
      data: txReq.data as `0x${string}`,
      valueNative: formatEther(valueWei),
    },
    estimateUsd: parseFloat(quote.estimate?.fromAmountUSD ?? "0"),
    tool: quote.tool ?? "lifi",
    approvalAddress: quote.estimate?.approvalAddress,
  };
}

export function lifiTokenAddress(addressOrNative: string): string {
  return addressOrNative === "native"
    ? "0x0000000000000000000000000000000000000000"
    : addressOrNative;
}

export async function buildApproveIfNeeded(opts: {
  chainId: number;
  owner: string;
  token: string;
  spender: string;
  amount: bigint;
}): Promise<Omit<TxRequest, "usdValue" | "summary" | "actionType"> | null> {
  const { createPublicClient, http, encodeFunctionData, erc20Abi } =
    await import("viem");
  const { getRpcUrl } = await import("../config.js");
  const client = createPublicClient({
    transport: http(getRpcUrl(opts.chainId)),
  });
  let allowance = 0n;
  try {
    allowance = await client.readContract({
      address: opts.token as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [
        opts.owner as `0x${string}`,
        opts.spender as `0x${string}`,
      ],
    });
  } catch {
    /* approve */
  }
  if (allowance >= opts.amount) return null;
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [opts.spender as `0x${string}`, opts.amount],
  });
  return {
    chainId: opts.chainId,
    to: opts.token,
    valueNative: "0",
    data,
  };
}
