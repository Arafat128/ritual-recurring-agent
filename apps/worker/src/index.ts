import fs from "node:fs";
import path from "node:path";
import {
  loadEnv,
  isDryRun,
  setSetting,
  WORKER,
  agentPrivateKey,
  getAppLimits,
  runWorkerTick,
  notify,
} from "@rra/core";
import { privateKeyToAccount } from "viem/accounts";

const root = loadEnv();
const PID_FILE = path.join(root, "data", "agent.pid");

function writePid() {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  const cleanup = () => {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      /* */
    }
  };
  process.on("exit", cleanup);
  for (const s of ["SIGINT", "SIGTERM"] as const) {
    process.on(s, () => {
      cleanup();
      process.exit(0);
    });
  }
}

async function main() {
  writePid();
  const account = privateKeyToAccount(agentPrivateKey());
  const limits = await getAppLimits();
  console.log(
    `[worker] Ritual Recurring Agent pid=${process.pid} DRY_RUN=${isDryRun()}`
  );
  console.log(`[worker] agent EOA ${account.address}`);
  console.log(
    `[worker] limits maxTxUsd=$${limits.maxTxUsd} maxTxPerDay=${limits.maxTxPerDay} loop=${limits.loopIntervalMs}ms`
  );

  await setSetting("agent.evm", account.address);
  await setSetting("worker.dryRun", String(isDryRun()));
  await setSetting("worker.startedAt", new Date().toISOString());

  console.log(
    `[worker] startup cooldown ${WORKER.startupCooldownMs / 1000}s…`
  );
  await new Promise((r) => setTimeout(r, WORKER.startupCooldownMs));
  await notify(
    `Ritual Recurring Agent started (${isDryRun() ? "DRY RUN" : "LIVE"}) ${account.address}`
  );

  let running = false;
  let tick = 0;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      await runWorkerTick();
      if (tick % 10 === 0) {
        const L = await getAppLimits();
        console.log(
          `[worker] heartbeat tick=${tick} maxTx/day=${L.maxTxPerDay} loop=${L.loopIntervalMs}ms`
        );
      }
    } catch (e) {
      console.error("[worker] loop error", e);
    } finally {
      tick++;
      running = false;
    }
  };

  // Re-read loop interval from DB each cycle so Settings changes apply without restart
  const schedule = async () => {
    await loop();
    let ms = WORKER.loopIntervalMs;
    try {
      ms = (await getAppLimits()).loopIntervalMs;
    } catch {
      /* keep default */
    }
    setTimeout(() => void schedule(), ms);
  };
  void schedule();
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
