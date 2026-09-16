# Newintel — build memory

Event-driven **demand intelligence** on a Stockintel shell, with GenLayer
as a **required** agent-settlement oracle (hackathon path).

## Product

- Business describes what they sell → orchestrator broadcasts to **every** online agent
- Agents **self-select**; decline is free. No specialist routing, no taxonomy
- Command carries `method` + `search_hints`: infer situations that create need, then search those — never the product keyword
- Orchestrator merges claims → report to the **business** (human path never waits on GenLayer)
- GenLayer holds findings + final copy → `adjudicate` → **agent** payout weights only

## Shell

- Forked from Stockintel (advanced equity shell), rebranded Newintel
- Binance / Agent OS market-check **removed**
- Demand copy, developers area, push+pull agent connector
- LLM: 0G `gpt-5.6-luna` → free OpenRouter → deterministic. Zen retired

## GenLayer (required for settlement)

- Network: **Bradbury testnet** (`testnet-bradbury`)
- Account: `0xa64f1832D8Dd4F8c6Ad434D3942a09fEFc9ad2b3` (funded)
- Contract: see `.env` → `GENLAYER_JUDGE_ADDRESS`
- Methods: `record_finding` · `record_final` · `adjudicate` · `get_verdict` · `payout_ready`
- Weights are **integer milli-shares** (sum 1000) — no LLM, no floats
- `scripts/settle-from-weights.ts` **exits fatal** without chain weights + `payout_ready`

### Proven path (Bradbury)

```
record_finding → ACCEPTED
record_final   → ACCEPTED
adjudicate     → FINISHED_WITH_RETURN
get_verdict    → { "agt-1": 840, "agt-2": 160, "ready": true }
payout_ready   → true
```

### Hard-won lessons

1. CLI often delivers JSON args as **dicts** — contracts must accept `typing.Any` and stringify
2. Non-JSON `record_final` strings must still count as recorded (`len > 0`)
3. LLM `adjudicate` times out / crashes GenVM — deterministic integer weights only
4. Bradbury writes **flake** — retry findings and adjudicate; fail closed if final/adjudicate fail after retries
5. Bun scripts need a **full genlayer path** (fnm shim not on default PATH)
6. Hosted Studionet health can be `degraded` (stuck tx on another contract) while **our judge still accepts writes**
7. `judge.ts` retries writes 3× with backoff; success = `ACCEPTED` / `FINISHED_WITH_RETURN` / `successfully executed`

## Live run

`INQ-mtzgdlgzicft` — packaging/cold-chain West Africa  
51 claims · 7 agents · report written  

**Chain settle DONE** (2026-09-15): 7/7 `record_finding` ACCEPTED, `record_final` ACCEPTED,
`adjudicate` ACCEPTED (1 retry). Verdict milli-weights sum 1000, `payout_ready=true`.
Local settlements replaced from chain weights only (no fallback).

**USDC payouts DONE** (2026-09-16): 7/7 paid $12.01 on Base Sepolia.

## Production (24/7, not a demo)

- Web: `https://stockintelislive.vercel.app` → project `primeisles/newintel` (git auto-deploy)
- AWS box `i-0018b77942c4452bc` (`100.61.3.35`) — **separate from stockintel units**
  - Code: `/opt/newintel` (public git clone)
  - Orchestrator: `newintel-orchestrator` port 8889
  - Agents: `newintel-*` ports 8810-8819, register to Newintel Vercel
- Shared DB: sqld docker `http://localhost:8000` on the box
  - Vercel: `DATABASE_URL=http://100.61.3.35:8000` + JWT `DATABASE_AUTH_TOKEN`
- Judge: `0x10713BFfC2D1811eE5F75d453534aFDE330AEaF8`
- Hook: `https://stockintelislive.vercel.app/api/wallet/relay-payout`
- Sponsor USDC: 200 on Base Sepolia (bridged from Arc via Bridge Kit)
- Faucet UI: no raw reverts; wallet copyable; receive needs no user gas
- Deploy AWS: SSM → pull `/opt/newintel` → restart `newintel-*` units

## Sibyl → GenLayer scoring

- `agentMemoryStats()` packs `verified_recalls` + `discoveries` into findings
- Judge adds +20/recall (cap 3) and +5/discovery (cap 5)
- Follow-up answer → verifiedRecalls++ in Sibyl → higher next-cycle weight

## Out of scope (intentionally)

- Buyer refunds / need-scores / human protection on GenLayer
- Binance market check / priced-in candles
- Specialist agent routing
- OpenCode Zen

## Next

- Fresh live inquiry end-to-end: claim → GenLayer settle → USDC payout → login faucet
- Tighten agent claim quality (street/site/contact, not bare 8-K lines)
- Top up signer when USDC drops under ~6 (need faucet grants + next pool)

## 2026-09-16 — why "20 agents" and empty UI

- Shared sqld holds **StockIntel (8790-8799) + Newintel (8810-8819)**. Both marked online.
- `listAgentsLive` / `agentsOnGrid` used every online row → product showed 20 and dispatched the wrong grid.
- Latest hotel-expansion run (`INQ-mu46w6j66cog`) completed with report+readout, but **all claims were StockIntel** (`agt-mtnud*`). Newintel agents healthy, silent.
- `stockintel-orchestrator` also runs on the same box and can steal Newintel inquiries from the shared `inquiries` table.
- Fix: `src/lib/orchestrator/grid.ts` port-band filter + `agents.grid` / `inquiries.product`; Newintel orchestrator only takes `product=newintel`.
- Report soft-parse so a schema drift no longer looks like "nothing came back".
- **URL**: `stockintelislive.vercel.app` is the **stockintel** Vercel project alias. Newintel production is `https://newintel.vercel.app`. AWS `PUBLIC_SUBMIT_URL` + agent units now point there.
- Newintel agents (8810-8819) were healthy but silent on the last run; StockIntel twins (8790-8799) produced every claim. StockIntel orchestrator still runs on the same box.
- README reframed 2026-09-16: demand graph for agents, methods stay private, GenLayer as settlement spine. Business app nav is workspace only; developer chapter is `/developers`.
- **Billing wired** (`src/lib/billing.ts`): signed-in runs require a verified Base USDC transfer (1 USDC) to the platform treasury. No free trials. Faucet sends 2 USDC + 0.001 ETH gas. Pool stamped on inquiry; settle-from-weights reads `pool_usd`.


