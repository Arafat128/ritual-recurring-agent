import path from "node:path";
import fs from "node:fs";
import { prisma } from "@rra/core";
import { restoreDurableState } from "@/lib/durableState";

/** Load monorepo .env before touching Prisma (local only; Vercel uses project env). */
export function ensureEnv() {
  if (!process.env.VERCEL) {
    const candidates = [
      path.resolve(process.cwd(), "../../.env"),
      path.resolve(process.cwd(), ".env"),
    ];
    for (const envPath of candidates) {
      if (!fs.existsSync(envPath)) continue;
      const text = fs.readFileSync(envPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i < 0) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (process.env[k] === undefined) process.env[k] = v;
      }
      break;
    }
  }

  if (!process.env.DATABASE_URL) {
    // Local monorepo path vs serverless writable path
    process.env.DATABASE_URL = process.env.VERCEL
      ? "file:/tmp/ritual-agent.db"
      : "file:../../../data/ritual-agent.db";
  } else if (
    process.env.VERCEL &&
    process.env.DATABASE_URL.includes("../../../data/")
  ) {
    // Relative local path from .env is not writable on Vercel
    process.env.DATABASE_URL = "file:/tmp/ritual-agent.db";
  }

}

let dbReady: Promise<void> | null = null;

/**
 * Ensure SQLite schema exists (needed on Vercel /tmp cold starts).
 * Safe to call on every request — runs DDL only once per instance.
 */
export async function ensureDb() {
  ensureEnv();
  if (!dbReady) {
    dbReady = (async () => {
      // CREATE IF NOT EXISTS — matches packages/core/prisma/schema.prisma
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "User" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "evmAddress" TEXT NOT NULL,
          "label" TEXT NOT NULL DEFAULT 'ritual-agent',
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "User_evmAddress_key" ON "User"("evmAddress");`,
      );
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Rule" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "type" TEXT NOT NULL,
          "action" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'active',
          "chainId" INTEGER NOT NULL,
          "tokenIn" TEXT,
          "tokenOut" TEXT,
          "amount" TEXT NOT NULL,
          "toAddress" TEXT,
          "toChainId" INTEGER,
          "priceTokenId" TEXT,
          "targetPrice" REAL,
          "direction" TEXT,
          "cron" TEXT,
          "nextRunAt" DATETIME,
          "lastRunAt" DATETIME,
          "lastError" TEXT,
          "failCount" INTEGER NOT NULL DEFAULT 0,
          "metaJson" TEXT,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Action" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "ruleId" TEXT,
          "type" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'pending',
          "chainId" INTEGER NOT NULL,
          "summary" TEXT NOT NULL,
          "command" TEXT,
          "txHash" TEXT,
          "error" TEXT,
          "usdValue" REAL,
          "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "Action_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "Setting" (
          "key" TEXT NOT NULL PRIMARY KEY,
          "value" TEXT NOT NULL,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    })().catch((e) => {
      dbReady = null;
      throw e;
    });
  }
  await dbReady;

  // Re-merge shared snapshot every request on Vercel so rules created on
  // another instance are visible to the worker / status APIs.
  if (process.env.VERCEL) {
    try {
      const { resetRestoreFlag } = await import("@/lib/durableState");
      resetRestoreFlag();
      await restoreDurableState();
    } catch (e) {
      console.warn("[ensureDb] restoreDurableState", e);
    }
  }
}
