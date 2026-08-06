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

export function tryAgentPrivateKey(): `0x${string}` | null {
  const k = process.env.AGENT_PRIVATE_KEY;
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) return null;
  return k as `0x${string}`;
}

export function agentPrivateKey(): `0x${string}` {
  const k = tryAgentPrivateKey();
  if (!k) {
    throw new Error(
      "AGENT_PRIVATE_KEY missing or invalid (need 0x + 64 hex chars)"
    );
  }
  return k;
}
