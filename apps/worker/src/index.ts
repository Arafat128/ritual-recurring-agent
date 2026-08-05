import fs from "node:fs";
import path from "node:path";
import {
  loadEnv,
  isDryRun,
  setSetting,
  WORKER,
  agentPrivateKey,
  prisma,
} from "@rra/core";
import { privateKeyToAccount } from "viem/accounts";
import { processRules } from "./rules.js";
import { notify } from "./notify.js";

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
  console.log(
    `[worker] Ritual Recurring Agent pid=${process.pid} DRY_RUN=${isDryRun()}`
  );
  console.log(`[worker] agent EOA ${account.address}`);

  await prisma.user.upsert({
    where: { evmAddress: account.address.toLowerCase() },
    create: {
      evmAddress: account.address.toLowerCase(),
      label: "ritual-agent",
    },
    update: {},
  });
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
      await processRules(account.address);
      await setSetting("worker.lastTickAt", new Date().toISOString());
      if (tick % 10 === 0) {
        console.log(`[worker] heartbeat tick=${tick}`);
      }
    } catch (e) {
      console.error("[worker] loop error", e);
    } finally {
      tick++;
      running = false;
    }
  };

  await loop();
  setInterval(loop, WORKER.loopIntervalMs);
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
