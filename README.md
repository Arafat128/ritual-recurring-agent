# Ritual Recurring Agent

Local-first **recurring agent** inspired by [DeFi Autopilot (WaaP)](https://github.com/Arafat128/defi-autopilot), rebuilt around **Ritual Chain** with a clear chain policy:

| Network | Role |
|---------|------|
| **Ritual Testnet (1979)** | Primary agent network — schedules, native RITUAL sends, ritual pings |
| **Sepolia (11155111)** | Agent testnet — Uniswap v3 swap demos |
| **Base mainnet (8453)** | **Only** mainnet for live DeFi (swaps / bridges via LI.FI) |

No WaaP. Worker uses an **agent EOA** (`AGENT_PRIVATE_KEY`). Dashboard **never executes** agent transactions — it only writes rules to SQLite.

---

## Ritual-specific features (what we added)

These are the **Ritual-oriented** pieces that differentiate this app from a plain DeFi autopilot:

| Feature | How it shows up in the app |
|---------|----------------------------|
| **Ritual Testnet (chain 1979)** | First-class chain in config + Rules UI; default for new rules |
| **Native currency RITUAL** | Send rules on Ritual use `RITUAL` (18 decimals) |
| **Ritual explorer links** | `https://explorer.ritualfoundation.org` for tx/address |
| **Public Ritual RPC** | Default `https://rpc.ritualfoundation.org` |
| **`ritual_ping` action** | Recurring audit tick aimed at Ritual agent ops (no value transfer) |
| **Ritual system addresses** | Documented constants for Scheduler, RitualWallet, HTTP/LLM precompiles (`packages/core/src/config.ts` → `RITUAL_SYSTEM`) |
| **Ritual-first policy** | Live DeFi **blocked** on Ritual (no fake Uniswap on 1979); DeFi only on Base mainnet |
| **Faucet path** | Setup points to [faucet.ritualfoundation.org](https://faucet.ritualfoundation.org) |
| **Endless-knot brand** | Dashboard background uses a Ritual-style endless knot visual (`public/knot-bg.jpeg`) |
| **Lime / cyan UI** | Matches other Ritual dApps (Rite / Radar aesthetic) |

### Ritual constants in code

```ts
// packages/core/src/config.ts
RITUAL_CHAIN_ID = 1979
RITUAL_SYSTEM = {
  wallet:    0x532F…3948,  // RitualWallet (async fees)
  scheduler: 0x56e7…D58B,  // on-chain Scheduler
  http:      0x0801,       // HTTP precompile
  llm:       0x0802,       // LLM precompile
}
```

### Ritual roadmap (next)

- [ ] Enshrined **Scheduler** wakes (on-chain recurring instead of only cron worker)
- [ ] **HTTP precompile** for price / data triggers (replace or complement CoinGecko)
- [ ] **RitualWallet** deposit/lock for async precompile fees
- [ ] Optional **LLM precompile** for agent reasoning steps
- [ ] Base LI.FI live swaps when `LIFI_API_KEY` is set (scaffolded)

---

## Recurring actions (like DeFi Autopilot)

| Trigger | Behavior |
|---------|----------|
| **Scheduled** | Cron builder (every N min/hours, daily, weekly, monthly, custom) |
| **Instant** | Fires once on next worker tick |
| **Limit order** | CoinGecko price above/below → then action |

| Action | Chains |
|--------|--------|
| **send** | Ritual (RITUAL), Sepolia (ETH), Base (ETH) |
| **swap** | Sepolia (Uniswap v3 demo), Base (LI.FI mainnet) |
| **bridge** | From **Base mainnet** only (LI.FI) |
| **ritual_ping** | Ritual-oriented audit tick |

**Dry run toggle** — Overview + Settings (DB-backed `worker.dryRun`; worker re-reads each tick).

**Editable app limits** — Settings UI for `maxTxUsd`, `maxTxPerDay`, and worker poll interval (stored in SQLite; overrides `.env` defaults without restart).

---

## Architecture

```
apps/dashboard   → Next.js UI (Overview · Rules · Settings) — writes SQLite only
apps/worker      → 30s loop: evaluate rules → executeAction
packages/core    → Prisma, chain config, limits, Uniswap/LI.FI routing, single send pipeline
```

Same discipline as DeFi Autopilot:

1. Dashboard never holds the agent key for execution  
2. Single `executeAction` path  
3. App limits: `MAX_TX_USD` / `MAX_TX_PER_DAY`  
4. Default `DRY_RUN=true`  

---

## Local setup tutorial (agent on your machine)

This walkthrough gets the **dashboard + worker agent** running fully local with SQLite.

### Prerequisites

- **Node.js 18+** (20 LTS recommended)
- **npm** (comes with Node)
- A **burner EOA** private key (never use a main wallet)
- Optional: MetaMask for viewing balances / funding the agent

### Step 1 — Clone and install

```bash
git clone https://github.com/Arafat128/ritual-recurring-agent.git
cd ritual-recurring-agent
npm install
```

`postinstall` generates the Prisma client automatically.

### Step 2 — Environment file

```bash
# macOS / Linux
cp .env.example .env

# Windows (PowerShell)
copy .env.example .env
```

Edit `.env` and set at least:

```env
# SQLite path is relative to packages/core/prisma/schema.prisma
DATABASE_URL="file:../../../data/ritual-agent.db"

# Burner key only — 0x + 64 hex chars
AGENT_PRIVATE_KEY=0xYOUR_BURNER_PRIVATE_KEY

# Keep true until activity feed dry_runs look correct
DRY_RUN=true

# Public Ritual RPC (default is fine for most users)
RPC_URL_RITUAL=https://rpc.ritualfoundation.org
```

Optional later:

| Variable | Purpose |
|----------|---------|
| `RPC_URL_SEPOLIA` | Sepolia Uniswap demos |
| `RPC_URL_BASE` | Base mainnet DeFi |
| `LIFI_API_KEY` | Live Base swap/bridge quotes |
| `MAX_TX_USD` / `MAX_TX_PER_DAY` | Default app limits (overridable in **Settings**) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional notify |

### Step 3 — Create the database

```bash
npm run db:push
```

This creates `data/ritual-agent.db` (SQLite). No Postgres required.

### Step 4 — Fund the agent (Ritual testnet)

1. Derive the public address from `AGENT_PRIVATE_KEY` (MetaMask import, or worker logs after first start).
2. Open the faucet: [faucet.ritualfoundation.org](https://faucet.ritualfoundation.org)
3. Send a small amount of **RITUAL** to the agent address.

You only need gas for **live** sends when dry run is off. Dry-run mode does not broadcast txs.

### Step 5 — Start dashboard + worker (two terminals)

**Terminal 1 — dashboard (UI + API):**

```bash
npm run dev
# → http://localhost:3020
```

**Terminal 2 — worker (the recurring agent loop):**

```bash
npm run worker
```

The worker:

- Registers the agent EOA in the DB / status API  
- Polls every ~30s  
- Evaluates **active** rules  
- Writes activity rows (`dry_run`, `executed`, `error`, `skipped`)  

If dry run is **ON** (default), no real chain txs are sent.

### Step 6 — Create your first rule

1. Open **http://localhost:3020**
2. Confirm **Dry run: ON** on Overview
3. Go to **Rules** → create e.g. a **scheduled send** on **Ritual (1979)**
4. Wait for the next worker tick (or use a short cron / instant rule)
5. Back on **Overview → Activity history**:
   - You should see `dry_run` rows with the command that *would* run  
   - **Delete** is available only on `dry_run` and `error` (failed) rows  
   - **Clear dry-run & failed** removes all of those; **executed** rows are kept  

### Step 7 — Go live (optional, careful)

1. Fund the agent on the target chain (Ritual faucet, Sepolia faucet, or Base real ETH).
2. Toggle **Dry run OFF** on Overview or Settings (DB override; worker re-reads each tick).
3. Confirm limits (`MAX_TX_USD`, `MAX_TX_PER_DAY`) before enabling.
4. Watch **Activity history** for `executed` + **tx hash** + explorer link.

### Production-style local run (optional)

```bash
npm run build
# Terminal 1
npm run start -w apps/dashboard   # or: next start -p 3020 from apps/dashboard
# Terminal 2
npm run worker
```

### Useful scripts

| Script | What it does |
|--------|----------------|
| `npm run dev` | Dashboard Next.js dev server (port **3020**) |
| `npm run worker` | Recurring agent loop |
| `npm run db:push` | Apply Prisma schema to SQLite |
| `npm run db:studio` | Browse DB in Prisma Studio |
| `npm run build` | Build core + dashboard |

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| Worker “offline?” on Overview | Start `npm run worker`; check Terminal 2 logs |
| No activity rows | Create an **active** rule; wait for next tick (~30s) |
| `AGENT_PRIVATE_KEY` errors | Must be `0x` + 64 hex; restart worker after editing `.env` |
| DB path issues | Run commands from repo root; re-run `npm run db:push` |
| Want to clear test noise | Use **Clear dry-run & failed** on Overview (cannot delete executed) |

---

## UI flow (quick)

1. Open dashboard → optional **Connect wallet** (context only; agent key stays in worker `.env`)  
2. **Rules** → scheduled / instant **send · swap · bridge · ritual_ping**  
3. Start **worker**  
4. **Overview** activity: `dry_run` / `executed` / `error` / `skipped`  
5. Delete **dry-run** or **failed** history anytime; keep real execution audit  
6. Toggle **Dry run OFF** only after dry-run logs look correct  

---

## Safety

- Never commit `.env` or private keys  
- Base mainnet = real funds when dry run is off  
- Swaps on Ritual are rejected by design  
- Bridges from testnets are skipped  
- Activity delete only allows `dry_run` and `error` — executed txs stay for audit  

---

## Deploy (Vercel dashboard)

The **Next.js dashboard** deploys to Vercel. The **worker** is a long-running process and must run separately (local machine, Railway, Fly, etc.).

```bash
# from monorepo root
vercel link          # once
vercel env add DRY_RUN production   # set true
vercel --prod
```

Notes:

- SQLite on Vercel uses `/tmp` (ephemeral per instance). Fine for demos; for shared durable state use Turso/Postgres later.
- Do **not** put a production `AGENT_PRIVATE_KEY` on Vercel unless you intentionally run txs from serverless (not recommended). Keep the key on the worker host only.
- Production URL pattern: `https://ritual-recurring-agent.vercel.app` (or your project alias).

---

## License

MIT — testnet / experimental software. Not financial advice.
