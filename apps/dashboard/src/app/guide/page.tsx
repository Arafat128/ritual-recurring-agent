"use client";

import Link from "next/link";

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="glass space-y-3 p-6">
        <h1 className="text-xl font-bold text-[#c8ff4a]">
          How this app works
        </h1>
        <p className="text-sm text-white/60">
          Multi-user recurring agent on{" "}
          <b className="text-white/80">Ritual Testnet (1979)</b>. You sign in
          with your wallet, prepay RITUAL credit, create rules, and a shared
          operator burner executes due rules for everyone.
        </p>
      </div>

      <section className="glass space-y-3 p-6">
        <h2 className="text-lg font-semibold text-cyan-200">For users</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-white/65">
          <li>
            Install MetaMask (or another injected wallet) and add Ritual
            Testnet — chain id <code className="text-[#c8ff4a]">1979</code>, RPC{" "}
            <code className="text-white/80">
              https://rpc.ritualfoundation.org
            </code>
            .
          </li>
          <li>
            Get testnet RITUAL from{" "}
            <a
              className="text-cyan-300 underline"
              href="https://faucet.ritualfoundation.org"
              target="_blank"
              rel="noreferrer"
            >
              faucet.ritualfoundation.org
            </a>
            .
          </li>
          <li>
            Open the app → <b className="text-white/85">Connect wallet</b> →
            approve the free sign-in message (no gas).
          </li>
          <li>
            Go to <Link href="/rules" className="text-cyan-300 underline">Rules</Link>
            . Top up credit: send RITUAL to the <b className="text-white/85">fee
            recipient</b> shown on the page, then click Pay &amp; credit (or
            paste the tx hash).
          </li>
          <li>
            Create a rule (scheduled send, ritual ping, etc.). Create fee is
            taken from your credit; each worker run charges a smaller run fee.
          </li>
          <li>
            Watch <Link href="/" className="text-cyan-300 underline">Overview</Link>{" "}
            for your activity only — other users cannot see your rules or
            history.
          </li>
        </ol>
        <p className="text-[12px] text-white/40">
          If a rule pauses with “Insufficient credit”, top up and set status
          back to active.
        </p>
      </section>

      <section className="glass space-y-3 p-6">
        <h2 className="text-lg font-semibold text-cyan-200">
          For operators (local run)
        </h2>
        <p className="text-sm text-white/60">
          You run the dashboard + worker with a funded burner. Users never need
          the burner private key.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-4 text-[11px] leading-relaxed text-emerald-100/90">
{`# 1) Clone & install
git clone https://github.com/Arafat128/ritual-recurring-agent.git
cd ritual-recurring-agent
npm install

# 2) Environment
copy .env.example .env          # Windows
# cp .env.example .env          # macOS / Linux

# Required in .env:
# DATABASE_URL="file:../../../data/ritual-agent.db"
# AGENT_PRIVATE_KEY=0xYOUR_BURNER_64_HEX
# FEE_RECIPIENT=0xSameOrTreasury   # receives user top-ups
# AUTH_SECRET=long-random-string
# (optional) OWNER_ADDRESSES=0xYourAdminWallet

# 3) Database
npm run db:push

# 4) Fund the burner on Ritual faucet
# https://faucet.ritualfoundation.org → AGENT address

# 5) Two terminals
npm run dev          # dashboard → http://localhost:3020
npm run worker       # registers agent.evm + executes rules`}
        </pre>
        <ul className="list-disc space-y-1 pl-5 text-sm text-white/55">
          <li>
            Worker must stay running (or use Vercel cron +{" "}
            <code className="text-white/80">CRON_SECRET</code> with{" "}
            <code className="text-white/80">AGENT_PRIVATE_KEY</code> only on a
            secure worker host).
          </li>
          <li>
            Do <b className="text-white/80">not</b> put the production burner key
            in the browser. Prefer worker process + optional serverless cron.
          </li>
          <li>
            Fee defaults (override via env): create ~0.001–0.005 RITUAL, run
            ~0.0002–0.0015 RITUAL depending on action.
          </li>
        </ul>
      </section>

      <section className="glass space-y-3 p-6">
        <h2 className="text-lg font-semibold text-cyan-200">Safety notes</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-white/55">
          <li>
            <b className="text-white/80">Send / swap / bridge</b> spend the
            operator burner’s funds (plus gas). Keep app limits low on testnet.
          </li>
          <li>
            Prefer <b className="text-white/80">ritual_ping</b> for light
            recurring checks; it only needs run fees + gas.
          </li>
          <li>
            Base mainnet DeFi is real money when dry-run is off — use a burner
            with limited balance.
          </li>
        </ul>
        <p className="text-[12px] text-white/40">
          Full detail lives in the repository README.
        </p>
      </section>
    </div>
  );
}
