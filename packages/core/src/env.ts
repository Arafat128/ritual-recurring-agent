import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** Resolve monorepo root */
export function loadEnv(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "../../..");
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) {
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
  }
  return root;
}

/** Env default only — prefer getDryRun() which reads DB toggle. */
export function isDryRunEnv(): boolean {
  const v = (process.env.DRY_RUN ?? "true").toLowerCase();
  return v !== "false" && v !== "0";
}

/** @deprecated use getDryRun from dryRun.ts for UI toggle */
export function isDryRun(): boolean {
  return isDryRunEnv();
}

export function agentPrivateKey(): `0x${string}` {
  const k = process.env.AGENT_PRIVATE_KEY;
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error(
      "AGENT_PRIVATE_KEY missing or invalid (need 0x + 64 hex chars)"
    );
  }
  return k as `0x${string}`;
}
