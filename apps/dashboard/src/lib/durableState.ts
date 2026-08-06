/**
 * Shared durable snapshot for Vercel serverless.
 *
 * Problem: SQLite lives on /tmp per instance — rules created on instance A
 * are invisible to the worker tick on instance B.
 *
 * Fix: after schema init, restore from Runtime Cache; after mutations / ticks,
 * persist rules + settings + recent actions back to the shared cache.
 *
 * Deletes use tombstones so a merge with an older snapshot cannot resurrect
 * a rule the user already removed.
 */
import { prisma } from "@rra/core";

const CACHE_KEY = "rra:db:snapshot:v1";
const TTL_SEC = 60 * 60 * 24 * 14; // 14 days
const MAX_TOMBSTONES = 300;

export type DbSnapshot = {
  v: 1 | 2;
  at: string;
  settings: { key: string; value: string; updatedAt?: string }[];
  rules: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  /** Rule ids permanently removed — never rehydrate */
  deletedRuleIds?: string[];
};

let lastPersistAt = 0;
let restoreDone = false;
/** In-process pending deletes (merged into next persist) */
const pendingDeletedRules = new Set<string>();

async function getRuntimeCache(): Promise<{
  get: (k: string) => Promise<unknown>;
  set: (
    k: string,
    v: unknown,
    o?: { ttl?: number; tags?: string[] }
  ) => Promise<void>;
} | null> {
  if (!process.env.VERCEL) return null;
  try {
    const { getCache } = await import("@vercel/functions");
    return getCache();
  } catch {
    return null;
  }
}

function toDate(v: unknown): Date | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function mergeTombstones(
  prev: string[] | undefined,
  extra: Iterable<string>
): string[] {
  const set = new Set<string>([...(prev || []), ...extra]);
  const arr = Array.from(set);
  // Keep newest-ish by just capping length (ids are cuid, order not critical)
  return arr.length > MAX_TOMBSTONES ? arr.slice(-MAX_TOMBSTONES) : arr;
}

/** Mark rule ids as deleted in shared state (call around local delete). */
export function markRulesDeleted(ids: string | string[]) {
  const list = Array.isArray(ids) ? ids : [ids];
  for (const id of list) {
    if (id) pendingDeletedRules.add(id);
  }
}

/** Pull shared snapshot into local SQLite (merge by id / key). */
export async function restoreDurableState(): Promise<{
  restored: boolean;
  rules: number;
  actions: number;
  settings: number;
}> {
  if (!process.env.VERCEL) {
    return { restored: false, rules: 0, actions: 0, settings: 0 };
  }
  if (restoreDone) {
    return { restored: false, rules: 0, actions: 0, settings: 0 };
  }

  const cache = await getRuntimeCache();
  if (!cache) {
    return { restored: false, rules: 0, actions: 0, settings: 0 };
  }

  let snap: DbSnapshot | null = null;
  try {
    snap = (await cache.get(CACHE_KEY)) as DbSnapshot | null;
  } catch (e) {
    console.warn("[durableState] cache get failed", e);
  }
  if (!snap || (snap.v !== 1 && snap.v !== 2)) {
    restoreDone = true;
    return { restored: false, rules: 0, actions: 0, settings: 0 };
  }

  const deleted = new Set(
    mergeTombstones(snap.deletedRuleIds, pendingDeletedRules)
  );

  // Enforce tombstones locally (rule may exist only on this /tmp db)
  if (deleted.size > 0) {
    try {
      await prisma.rule.deleteMany({
        where: { id: { in: Array.from(deleted) } },
      });
    } catch {
      /* */
    }
  }

  let rulesN = 0;
  let actionsN = 0;
  let settingsN = 0;

  for (const s of snap.settings || []) {
    if (!s?.key) continue;
    try {
      await prisma.setting.upsert({
        where: { key: s.key },
        create: { key: s.key, value: String(s.value ?? "") },
        update: { value: String(s.value ?? "") },
      });
      settingsN++;
    } catch {
      /* skip bad row */
    }
  }

  for (const r of snap.rules || []) {
    const id = String(r.id || "");
    if (!id || deleted.has(id)) continue;
    try {
      const data = {
        type: String(r.type),
        action: String(r.action),
        status: String(r.status || "active"),
        chainId: Number(r.chainId),
        tokenIn: r.tokenIn != null ? String(r.tokenIn) : null,
        tokenOut: r.tokenOut != null ? String(r.tokenOut) : null,
        amount: String(r.amount ?? "0"),
        toAddress: r.toAddress != null ? String(r.toAddress) : null,
        toChainId: r.toChainId != null ? Number(r.toChainId) : null,
        priceTokenId: r.priceTokenId != null ? String(r.priceTokenId) : null,
        targetPrice:
          r.targetPrice != null && r.targetPrice !== ""
            ? Number(r.targetPrice)
            : null,
        direction: r.direction != null ? String(r.direction) : null,
        cron: r.cron != null ? String(r.cron) : null,
        nextRunAt: toDate(r.nextRunAt) ?? null,
        lastRunAt: toDate(r.lastRunAt) ?? null,
        lastError: r.lastError != null ? String(r.lastError) : null,
        failCount: Number(r.failCount || 0),
        metaJson: r.metaJson != null ? String(r.metaJson) : null,
        createdAt: toDate(r.createdAt) ?? new Date(),
        updatedAt: toDate(r.updatedAt) ?? new Date(),
      };
      await prisma.rule.upsert({
        where: { id },
        create: { id, ...data },
        update: {
          type: data.type,
          action: data.action,
          status: data.status,
          chainId: data.chainId,
          tokenIn: data.tokenIn,
          tokenOut: data.tokenOut,
          amount: data.amount,
          toAddress: data.toAddress,
          toChainId: data.toChainId,
          priceTokenId: data.priceTokenId,
          targetPrice: data.targetPrice,
          direction: data.direction,
          cron: data.cron,
          nextRunAt: data.nextRunAt,
          lastRunAt: data.lastRunAt,
          lastError: data.lastError,
          failCount: data.failCount,
          metaJson: data.metaJson,
          updatedAt: data.updatedAt,
        },
      });
      rulesN++;
    } catch (e) {
      console.warn("[durableState] rule upsert", id, e);
    }
  }

  for (const a of snap.actions || []) {
    const id = String(a.id || "");
    if (!id) continue;
    try {
      const existing = await prisma.action.findUnique({ where: { id } });
      if (existing) continue;
      // Detach FK if parent rule was deleted
      let ruleId = a.ruleId != null ? String(a.ruleId) : null;
      if (ruleId && deleted.has(ruleId)) ruleId = null;
      if (ruleId) {
        const parent = await prisma.rule.findUnique({ where: { id: ruleId } });
        if (!parent) ruleId = null;
      }
      await prisma.action.create({
        data: {
          id,
          ruleId,
          type: String(a.type),
          status: String(a.status || "pending"),
          chainId: Number(a.chainId),
          summary: String(a.summary || ""),
          command: a.command != null ? String(a.command) : null,
          txHash: a.txHash != null ? String(a.txHash) : null,
          error: a.error != null ? String(a.error) : null,
          usdValue: a.usdValue != null ? Number(a.usdValue) : null,
          createdAt: toDate(a.createdAt) ?? new Date(),
          updatedAt: toDate(a.updatedAt) ?? new Date(),
        },
      });
      actionsN++;
    } catch {
      /* skip FK / dup */
    }
  }

  restoreDone = true;
  console.log(
    `[durableState] restored rules=${rulesN} actions=${actionsN} settings=${settingsN} tombstones=${deleted.size} from=${snap.at}`,
  );
  return {
    restored: rulesN + actionsN + settingsN > 0,
    rules: rulesN,
    actions: actionsN,
    settings: settingsN,
  };
}

/** Push local SQLite state to shared Runtime Cache. */
export async function persistDurableState(opts?: {
  deletedRuleIds?: string[];
}): Promise<boolean> {
  if (opts?.deletedRuleIds?.length) {
    markRulesDeleted(opts.deletedRuleIds);
  }

  if (!process.env.VERCEL) {
    // Local: still clear pending set after disk delete
    pendingDeletedRules.clear();
    return false;
  }

  const now = Date.now();
  if (now - lastPersistAt < 200) {
    /* allow */
  }
  lastPersistAt = now;

  const cache = await getRuntimeCache();
  if (!cache) return false;

  try {
    const [settings, rules, actions] = await Promise.all([
      prisma.setting.findMany(),
      prisma.rule.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.action.findMany({ orderBy: { createdAt: "desc" }, take: 80 }),
    ]);

    let prev: DbSnapshot | null = null;
    try {
      prev = (await cache.get(CACHE_KEY)) as DbSnapshot | null;
    } catch {
      /* */
    }

    const deleted = mergeTombstones(
      prev?.deletedRuleIds,
      pendingDeletedRules
    );
    const deletedSet = new Set(deleted);

    const settingMap = new Map<
      string,
      { key: string; value: string; updatedAt?: string }
    >();
    for (const s of prev?.settings || []) {
      if (s?.key) settingMap.set(s.key, s);
    }
    for (const s of settings) {
      settingMap.set(s.key, {
        key: s.key,
        value: s.value,
        updatedAt: s.updatedAt?.toISOString?.() ?? new Date().toISOString(),
      });
    }

    const ruleMap = new Map<string, Record<string, unknown>>();
    for (const r of prev?.rules || []) {
      const id = r?.id ? String(r.id) : "";
      if (!id || deletedSet.has(id)) continue;
      ruleMap.set(id, r as Record<string, unknown>);
    }
    for (const r of rules) {
      if (deletedSet.has(r.id)) continue;
      ruleMap.set(r.id, {
        ...r,
        nextRunAt: r.nextRunAt?.toISOString?.() ?? r.nextRunAt,
        lastRunAt: r.lastRunAt?.toISOString?.() ?? r.lastRunAt,
        createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
        updatedAt: r.updatedAt?.toISOString?.() ?? r.updatedAt,
      });
    }
    // Enforce tombstones after overlay
    for (const id of deletedSet) ruleMap.delete(id);

    const actionMap = new Map<string, Record<string, unknown>>();
    for (const a of prev?.actions || []) {
      if (a?.id) actionMap.set(String(a.id), a as Record<string, unknown>);
    }
    for (const a of actions) {
      actionMap.set(a.id, {
        ...a,
        // Detach deleted parents in snapshot
        ruleId:
          a.ruleId && deletedSet.has(a.ruleId) ? null : a.ruleId,
        createdAt: a.createdAt?.toISOString?.() ?? a.createdAt,
        updatedAt: a.updatedAt?.toISOString?.() ?? a.updatedAt,
      });
    }

    const actionList = Array.from(actionMap.values())
      .sort((a, b) => {
        const ta = new Date(String(a.createdAt || 0)).getTime();
        const tb = new Date(String(b.createdAt || 0)).getTime();
        return tb - ta;
      })
      .slice(0, 80);

    const snap: DbSnapshot = {
      v: 2,
      at: new Date().toISOString(),
      settings: Array.from(settingMap.values()),
      rules: Array.from(ruleMap.values()),
      actions: actionList,
      deletedRuleIds: deleted,
    };

    await cache.set(CACHE_KEY, snap, {
      ttl: TTL_SEC,
      tags: ["rra-db"],
    });

    // Pending deletes are now in the shared tombstone list
    pendingDeletedRules.clear();
    return true;
  } catch (e) {
    console.warn("[durableState] persist failed", e);
    return false;
  }
}

/** Allow re-restore after long-lived instance (rarely needed). */
export function resetRestoreFlag() {
  restoreDone = false;
}
