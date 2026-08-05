import { getSetting, setSetting } from "./db.js";
import { isDryRunEnv } from "./env.js";

const KEY = "worker.dryRun";

/**
 * Effective dry-run: DB toggle wins when set; else .env DRY_RUN.
 * Dashboard can flip this without restarting the process for new ticks
 * (worker re-reads each executeAction).
 */
export async function getDryRun(): Promise<boolean> {
  try {
    const v = await getSetting(KEY);
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  } catch {
    /* db not ready */
  }
  return isDryRunEnv();
}

export async function setDryRun(on: boolean): Promise<void> {
  await setSetting(KEY, on ? "true" : "false");
}
