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

## Setup

```bash
cd ritual-recurring-agent
npm install
cp .env.example .env   # Windows: copy .env.example .env
# set AGENT_PRIVATE_KEY (0x…) — use a burner
# keep DRY_RUN=true until you verify dry_run logs

npm run db:push

# Terminal 1 — dashboard
npm run dev
# → http://localhost:3020

# Terminal 2 — worker
npm run worker
```

Fund the agent on Ritual: [faucet.ritualfoundation.org](https://faucet.ritualfoundation.org).

### Useful env

| Variable | Purpose |
|----------|---------|
| `AGENT_PRIVATE_KEY` | Worker EOA (required) |
| `DRY_RUN` | Env default; UI override stored in DB |
| `RPC_URL_RITUAL` | Ritual RPC |
| `RPC_URL_SEPOLIA` | Sepolia RPC |
| `RPC_URL_BASE` | Base mainnet RPC |
| `LIFI_API_KEY` | Optional; Base swap/bridge quotes |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional notifications |

---

## UI flow

1. Open dashboard → optional **Connect wallet** (context only)  
2. **Rules** → scheduled **send / swap / bridge**  
3. Start **worker**  
4. **Overview** activity feed: `dry_run` / `executed` / `skipped`  
5. Toggle **Dry run OFF** only after logs look correct  

---

## Safety

- Never commit `.env` or private keys  
- Base mainnet = real funds when dry run is off  
- Swaps on Ritual are rejected by design  
- Bridges from testnets are skipped  

---

## License

MIT — testnet / experimental software. Not financial advice.
