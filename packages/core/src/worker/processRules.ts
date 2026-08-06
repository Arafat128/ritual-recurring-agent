import parser from "cron-parser";
import { parseUnits } from "viem";
import {
  CHAINS,
  WORKER,
  BASE_MAINNET_ID,
  RITUAL_CHAIN_ID,
  SEPOLIA_ID,
  getToken,
  getChain,
} from "../config.js";
import { prisma } from "../db.js";
import { executeAction } from "../executeAction.js";
import { buildUniswapSwap } from "../routing/uniswap.js";
import {
  getLifiQuote,
  lifiTokenAddress,
  buildApproveIfNeeded,
} from "../routing/lifi.js";
import type { TxRequest } from "../types.js";
import { getPrices } from "./prices.js";
import { notify } from "./notify.js";

type Rule = Awaited<ReturnType<typeof prisma.rule.findMany>>[number];

function truncateError(err: string, max = 300): string {
  return err.length > max ? err.slice(0, max) + " …" : err;
}

function parseAmountUsd(rule: Rule, prices: Map<string, number>): number {
  const amt = Number(rule.amount) || 0;
  const chain = CHAINS[rule.chainId];
  if (!chain) return 0;
  if (rule.action === "ritual_ping") return 0;
  if (rule.action === "send") {
    if (chain.family === "ritual") return Math.min(amt, 1);
    const px = prices.get(chain.coingeckoNativeId) ?? 0;
    return amt * px;
  }
  const tok = getToken(rule.chainId, rule.tokenIn || chain.nativeSymbol);
  const px = tok ? (prices.get(tok.coingeckoId) ?? 0) : 0;
  return amt * px;
}

async function finishRule(rule: Rule, err: string | null) {
  if (rule.type === "instant" || rule.type === "limit_order") {
    await prisma.rule.update({
      where: { id: rule.id },
      data: {
        status: err ? "error" : "completed",
        lastRunAt: new Date(),
        lastError: err,
        failCount: err ? rule.failCount + 1 : 0,
      },
    });
  } else {
    let next: Date | null = null;
    if (rule.cron) {
      try {
        next = parser.parseExpression(rule.cron).next().toDate();
      } catch {
        next = new Date(Date.now() + 3_600_000);
      }
    }
    const fails = err ? rule.failCount + 1 : 0;
    await prisma.rule.update({
      where: { id: rule.id },
      data: {
        status:
          err && fails >= WORKER.maxConsecutiveFailures ? "error" : "active",
        lastRunAt: new Date(),
        lastError: err,
        failCount: fails,
        nextRunAt: next ?? undefined,
      },
    });
  }
}

async function failRule(rule: Rule, err: string) {
  await finishRule(rule, truncateError(err));
}

async function runRule(
  rule: Rule,
  agentEvm: string,
  prices: Map<string, number>
) {
  const claimed = await prisma.rule.updateMany({
    where: { id: rule.id, status: "active" },
    data: { status: "executing" },
  });
  if (claimed.count === 0) return;

  const chain = CHAINS[rule.chainId];
  const native = chain?.nativeSymbol ?? "ETH";
  const summaryBase =
    rule.action === "send"
      ? `send ${rule.amount} ${rule.tokenIn ?? native} → ${rule.toAddress}`
      : rule.action === "ritual_ping"
        ? `ritual_ping chain ${rule.chainId}`
        : rule.action === "bridge"
          ? `bridge ${rule.amount} ${rule.tokenIn} → ${rule.tokenOut} (${rule.chainId}→${rule.toChainId})`
          : `swap ${rule.amount} ${rule.tokenIn} → ${rule.tokenOut}`;

  try {
    await notify(`Rule: ${rule.type} — ${summaryBase}`);
    let usd = parseAmountUsd(rule, prices);
    const txs: TxRequest[] = [];

    if (rule.action === "ritual_ping") {
      await prisma.action.create({
        data: {
          ruleId: rule.id,
          type: "ritual_ping",
          status: "dry_run",
          chainId: rule.chainId || RITUAL_CHAIN_ID,
          summary: `${summaryBase} (audit tick)`,
          usdValue: 0,
        },
      });
      await finishRule(rule, null);
      return;
    }

    if (rule.action === "send") {
      if (!rule.toAddress) throw new Error("toAddress required for send");
      txs.push({
        chainId: rule.chainId,
        to: rule.toAddress,
        valueNative: rule.amount,
        usdValue: usd,
        summary: summaryBase,
        ruleId: rule.id,
        actionType: "send",
      });
    } else if (rule.action === "swap") {
      const c = getChain(rule.chainId);
      if (rule.chainId === SEPOLIA_ID && c.uniswapV3Router) {
        const plan = await buildUniswapSwap({
          chainId: rule.chainId,
          agentAddress: agentEvm,
          tokenInSymbol: rule.tokenIn || "ETH",
          tokenOutSymbol: rule.tokenOut || "USDC",
          amount: rule.amount,
        });
        if (plan.approveTx) {
          txs.push({
            ...plan.approveTx,
            usdValue: 0,
            summary: `approve ${rule.tokenIn} for Uniswap`,
            ruleId: rule.id,
            actionType: "approve",
          });
        }
        txs.push({
          ...plan.swapTx,
          usdValue: usd,
          summary: `${summaryBase} via Uniswap v3 [Sepolia]`,
          ruleId: rule.id,
          actionType: "swap",
        });
      } else if (rule.chainId === BASE_MAINNET_ID && c.allowLiveDefi) {
        const tokenIn = getToken(rule.chainId, rule.tokenIn || "ETH");
        const tokenOut = getToken(rule.chainId, rule.tokenOut || "USDC");
        if (!tokenIn || !tokenOut) throw new Error("Unknown swap tokens");
        const fromAmount = parseUnits(rule.amount, tokenIn.decimals);
        const quote = await getLifiQuote({
          fromChainId: rule.chainId,
          toChainId: rule.chainId,
          fromToken: lifiTokenAddress(tokenIn.address),
          toToken: lifiTokenAddress(tokenOut.address),
          fromAmount: fromAmount.toString(),
          fromAddress: agentEvm,
        });
        if (quote.estimateUsd > 0) usd = quote.estimateUsd;
        if (tokenIn.address !== "native" && quote.approvalAddress) {
          const approve = await buildApproveIfNeeded({
            chainId: rule.chainId,
            owner: agentEvm,
            token: tokenIn.address,
            spender: quote.approvalAddress,
            amount: fromAmount,
          });
          if (approve) {
            txs.push({
              ...approve,
              usdValue: 0,
              summary: `approve ${rule.tokenIn} for LI.FI`,
              ruleId: rule.id,
              actionType: "approve",
            });
          }
        }
        txs.push({
          ...quote.tx,
          usdValue: usd,
          summary: `${summaryBase} via LI.FI/${quote.tool} [Base]`,
          ruleId: rule.id,
          actionType: "swap",
        });
      } else {
        await prisma.action.create({
          data: {
            ruleId: rule.id,
            type: "swap",
            status: "skipped",
            chainId: rule.chainId,
            summary: `${summaryBase} — swap on Sepolia (Uniswap) or Base mainnet (LI.FI) only`,
            usdValue: usd,
          },
        });
        await finishRule(rule, "swap unsupported on this chain");
        return;
      }
    } else if (rule.action === "bridge") {
      const fromId = rule.chainId;
      const toId = rule.toChainId;
      if (!toId) throw new Error("toChainId required for bridge");
      const fromChain = getChain(fromId);
      if (fromChain.testnet || getChain(toId).testnet) {
        await prisma.action.create({
          data: {
            ruleId: rule.id,
            type: "bridge",
            status: "skipped",
            chainId: fromId,
            summary: `${summaryBase} — bridges require mainnet (Base). Testnets skipped.`,
            usdValue: usd,
          },
        });
        await finishRule(rule, "bridge not available on testnets");
        return;
      }
      // Mainnet bridge only from Base in this app
      if (fromId !== BASE_MAINNET_ID) {
        await prisma.action.create({
          data: {
            ruleId: rule.id,
            type: "bridge",
            status: "skipped",
            chainId: fromId,
            summary: `${summaryBase} — this agent only bridges from Base mainnet`,
            usdValue: usd,
          },
        });
        await finishRule(rule, "bridge only from Base");
        return;
      }
      const tokenIn = getToken(fromId, rule.tokenIn || "ETH");
      if (!tokenIn) throw new Error("Unknown token for bridge");
      const fromAmount = parseUnits(rule.amount, tokenIn.decimals);
      const toToken = getToken(toId, rule.tokenOut || "ETH");
      const quote = await getLifiQuote({
        fromChainId: fromId,
        toChainId: toId,
        fromToken: lifiTokenAddress(tokenIn.address),
        toToken: toToken
          ? lifiTokenAddress(toToken.address)
          : rule.tokenOut || "ETH",
        fromAmount: fromAmount.toString(),
        fromAddress: agentEvm,
      });
      if (quote.estimateUsd > 0) usd = quote.estimateUsd;
      if (tokenIn.address !== "native" && quote.approvalAddress) {
        const approve = await buildApproveIfNeeded({
          chainId: fromId,
          owner: agentEvm,
          token: tokenIn.address,
          spender: quote.approvalAddress,
          amount: fromAmount,
        });
        if (approve) {
          txs.push({
            ...approve,
            usdValue: 0,
            summary: `approve ${rule.tokenIn} for LI.FI bridge`,
            ruleId: rule.id,
            actionType: "approve",
          });
        }
      }
      txs.push({
        ...quote.tx,
        usdValue: usd,
        summary: `${summaryBase} via LI.FI/${quote.tool}`,
        ruleId: rule.id,
        actionType: "bridge",
      });
    }

    for (const tx of txs) {
      const result = await executeAction(tx);
      if (result.status === "executed") {
        await notify(`Executed: ${tx.summary}\n${result.txHash}`);
      } else if (result.status === "dry_run") {
        console.log(`[rules] DRY_RUN ${tx.summary}`);
      } else if (result.status === "skipped") {
        await failRule(rule, result.error ?? "skipped");
        return;
      } else {
        await failRule(rule, result.error ?? "error");
        return;
      }
    }
    await finishRule(rule, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[rules] ${rule.id}`, msg);
    await failRule(rule, msg);
  }
}

function dueScheduled(rule: Rule, now: Date): boolean {
  if (rule.type !== "scheduled") return false;
  if (rule.nextRunAt) return rule.nextRunAt.getTime() <= now.getTime();
  if (!rule.cron) return false;
  try {
    const prev = parser.parseExpression(rule.cron).prev().toDate();
    if (!rule.lastRunAt) return true;
    return rule.lastRunAt.getTime() < prev.getTime();
  } catch {
    return false;
  }
}

function dueLimit(rule: Rule, prices: Map<string, number>): boolean {
  if (rule.type !== "limit_order") return false;
  if (rule.targetPrice == null || !rule.priceTokenId || !rule.direction)
    return false;
  const px = prices.get(rule.priceTokenId);
  if (px == null) return false;
  if (rule.direction === "above") return px >= rule.targetPrice;
  return px <= rule.targetPrice;
}

export async function processRules(agentEvm: string): Promise<void> {
  const rules = await prisma.rule.findMany({ where: { status: "active" } });
  const priceIds = new Set<string>();
  for (const r of rules) {
    if (r.priceTokenId) priceIds.add(r.priceTokenId);
    const c = CHAINS[r.chainId];
    if (c) priceIds.add(c.coingeckoNativeId);
    if (r.tokenIn) {
      const t = getToken(r.chainId, r.tokenIn);
      if (t) priceIds.add(t.coingeckoId);
    }
  }
  const prices = await getPrices([...priceIds]);
  const now = new Date();

  for (const rule of rules) {
    let fire = false;
    if (rule.type === "instant") fire = true;
    else if (rule.type === "scheduled") fire = dueScheduled(rule, now);
    else if (rule.type === "limit_order") fire = dueLimit(rule, prices);
    if (!fire) continue;
    await runRule(rule, agentEvm, prices);
  }
}
