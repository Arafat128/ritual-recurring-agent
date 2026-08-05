import {
  encodeFunctionData,
  parseUnits,
  createPublicClient,
  http,
  erc20Abi,
} from "viem";
import { CHAINS, getRpcUrl, getToken } from "../config.js";
import type { TxRequest } from "../types.js";

const ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export interface SwapPlan {
  approveTx?: Omit<TxRequest, "usdValue" | "summary" | "actionType">;
  swapTx: Omit<TxRequest, "usdValue" | "summary" | "actionType">;
}

/** Uniswap v3 direct swap — Sepolia demo path (amountOutMin=0 testnet only). */
export async function buildUniswapSwap(opts: {
  chainId: number;
  agentAddress: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amount: string;
}): Promise<SwapPlan> {
  const chain = CHAINS[opts.chainId];
  if (!chain?.uniswapV3Router) {
    throw new Error(`No Uniswap v3 router for chain ${opts.chainId}`);
  }
  const tokenIn = getToken(opts.chainId, opts.tokenInSymbol);
  const tokenOut = getToken(opts.chainId, opts.tokenOutSymbol);
  if (!tokenIn || !tokenOut) {
    throw new Error(
      `Unknown token ${opts.tokenInSymbol} or ${opts.tokenOutSymbol}`
    );
  }

  const isNativeIn = tokenIn.address === "native";
  const tokenInAddr = isNativeIn ? chain.weth! : tokenIn.address;
  const tokenOutAddr =
    tokenOut.address === "native" ? chain.weth! : tokenOut.address;
  const amountIn = parseUnits(opts.amount, tokenIn.decimals);

  const swapData = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: tokenInAddr as `0x${string}`,
        tokenOut: tokenOutAddr as `0x${string}`,
        fee: 3000,
        recipient: opts.agentAddress as `0x${string}`,
        amountIn,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const plan: SwapPlan = {
    swapTx: {
      chainId: opts.chainId,
      to: chain.uniswapV3Router,
      valueNative: isNativeIn ? opts.amount : "0",
      data: swapData,
    },
  };

  if (!isNativeIn) {
    const client = createPublicClient({
      transport: http(getRpcUrl(opts.chainId)),
    });
    let allowance = 0n;
    try {
      allowance = await client.readContract({
        address: tokenInAddr as `0x${string}`,
        abi: erc20Abi,
        functionName: "allowance",
        args: [
          opts.agentAddress as `0x${string}`,
          chain.uniswapV3Router as `0x${string}`,
        ],
      });
    } catch {
      /* approve */
    }
    if (allowance < amountIn) {
      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [chain.uniswapV3Router as `0x${string}`, amountIn],
      });
      plan.approveTx = {
        chainId: opts.chainId,
        to: tokenInAddr,
        valueNative: "0",
        data: approveData,
      };
    }
  }

  return plan;
}
