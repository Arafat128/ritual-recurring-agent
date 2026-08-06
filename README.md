# Ritual Recurring Agent

**Multi-user** recurring automation on [Ritual Testnet](https://docs.ritualfoundation.org) (chain id `1979`).

Users sign in with **their own wallets**, prepay **RITUAL credit**, create rules, and a **shared operator burner** executes due rules for everyone.

| | |
|--|--|
| **Dashboard** | Next.js UI — rules, credit top-up, history |
| **Worker** | Long-running process (or cron) holding `AGENT_PRIVATE_KEY` |
| **Currency** | RITUAL (testnet) for fees · optional Base mainnet for live DeFi |

---

## Product model

```
User wallet (MetaMask)
   │  SIWE sign-in
   │  Top-up RITUAL → FEE_RECIPIENT
   │  Create / pause rules (debited from prepaid credit)
   ▼
Dashboard (any host)  ──SQLite──►  Rules + Account credit + Payments
   │
   │  worker tick
   ▼
Shared burner (AGENT_PRIVATE_KEY)
   │  pays gas (+ send/swap value from burner balance)
   │  debits user run_fee credit each execution
   ▼
Ritual / Sepolia / Base
```

| Role | Who | Does |
|------|-----|------|
| **User** | Any signed-in EOA | Own rules, own history, prepaid credit |
| **Operator burner** | `AGENT_PRIVATE_KEY` | Executes txs for all users |
| **Admin** | Agent EOA and/or `OWNER_ADDRESSES` | Global limits in Settings |

Users **never** need the burner private key.

---

## Fees (defaults)

Override with `FEE_*` env vars (see `.env.example`).

| Charge | When | Default (RITUAL) |
|--------|------|------------------|
| **Create** | New rule | Base ~0.001 + action + recurring uplift |
| **Run** | Each successful worker fire | Ping ~0.0002 · send ~0.0005 · swap/bridge higher |

If credit is too low for a run, the rule is **paused** until the user tops up and resumes.

---

## Local run (operator)

### Prerequisites

- Node.js 18+ (20 LTS recommended)
- A **burner** private key (never a main wallet)
- MetaMask for testing as a user

### 1. Install

```bash
git clone https://github.com/Arafat128/ritual-recurring-agent.git
cd ritual-recurring-agent
npm install
```

### 2. Environment

```bash
# Windows PowerShell
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL="file:../../../data/ritual-agent.db"
AGENT_PRIVATE_KEY=0xYOUR_BURNER_64_HEX_CHARS
FEE_RECIPIENT=0xSameAsBurnerOrTreasury
AUTH_SECRET=long-random-string-here
# optional admin wallets:
# OWNER_ADDRESSES=0xYourPersonalWallet
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `AGENT_PRIVATE_KEY` | Yes (worker) | Shared executor EOA |
| `FEE_RECIPIENT` | Recommended | Where users send top-ups (defaults to agent after first worker start) |
| `AUTH_SECRET` | Production | Signs session cookies |
| `OWNER_ADDRESSES` | Optional | Admin wallets for global Settings |
| `DATABASE_URL` | Yes | SQLite path |

### 3. Database

```bash
npm run db:push
```

Creates/updates `data/ritual-agent.db` with multi-tenant tables (`Account`, `Payment`, `ownerAddress` on rules).

### 4. Fund the burner

1. Derive the address from `AGENT_PRIVATE_KEY` (import in MetaMask or worker logs).
2. [faucet.ritualfoundation.org](https://faucet.ritualfoundation.org) → send **RITUAL** for gas (and small sends if you allow send rules).
3. Optionally fund Base mainnet only if you enable live DeFi.

### 5. Start dashboard + worker

```bash
# Terminal 1 — UI (default port 3020)
npm run dev

# Terminal 2 — executor
npm run worker
```

Open [http://localhost:3020](http://localhost:3020).

### 6. Use as a normal user

1. Connect **your** MetaMask (any wallet — not necessarily the burner).
2. Sign the login message.
3. **Rules** → top up RITUAL to the fee recipient → create a rule.
4. Leave the **worker** running so schedules fire.
5. **Guide** page in the app mirrors this for end users.

### 7. Operator checklist

- [ ] Worker online (Overview shows last tick)
- [ ] `FEE_RECIPIENT` matches where users pay
- [ ] Burner has gas on Ritual
- [ ] App limits (`MAX_TX_USD`, `MAX_TX_PER_DAY`) sane for shared burners
- [ ] Prefer `ritual_ping` for demos; **send/swap spend burner funds**

---

## Chains

| Network | ID | Role |
|---------|-----|------|
| **Ritual Testnet** | 1979 | Fees, native send, ritual_ping |
| **Sepolia** | 11155111 | Uniswap v3 demo swaps |
| **Base mainnet** | 8453 | Live DeFi only (LI.FI) |

---

## Deploy (Vercel dashboard)

```bash
vercel link
vercel env add AUTH_SECRET production
vercel env add FEE_RECIPIENT production
# Prefer NOT putting AGENT_PRIVATE_KEY on Vercel unless you accept serverless risk
vercel --prod
```

- SQLite on Vercel is **ephemeral** (`/tmp`) unless you attach durable storage / Turso later.
- Keep **worker** on a VPS, Railway, Fly, or always-on machine with the burner key.
- Optional: `CRON_SECRET` + `/api/cron/worker` for serverless ticks **only if** the key is on that environment and you accept the risk.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dashboard dev server |
| `npm run worker` | Recurring executor loop |
| `npm run db:push` | Apply Prisma schema |
| `npm run db:studio` | Browse SQLite |
| `npm run build` | Build core + dashboard |

---

## API sketch

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/auth/verify` | SIWE | Any wallet → session |
| `GET/POST /api/account` | User | Credit balance / top-up by txHash |
| `GET /api/fees/quote` | Public | Create + run fee quote |
| `GET/POST /api/rules` | User | Own rules only |
| `GET /api/status` | User | Own rules + actions + credit |
| `PATCH /api/settings` | Admin | Global limits |

---

## Security

- Session: HttpOnly cookie + HMAC (`AUTH_SECRET`).
- Rules and history are **scoped by `ownerAddress`**.
- Burner key never goes to the browser.
- Shared burner risk: rate limits, pause rules, fund carefully.
- Testnet software — not financial advice.

---

## License

MIT — experimental / testnet software.
