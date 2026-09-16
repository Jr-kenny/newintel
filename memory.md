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

```
agt-…2mklhr 174 · 2347yc/dunkx/1295z8/1yqbji 168 · 80tgfpq/28ju1u 77
```

## Base USDC (faucet + payouts)

- Network: Base Sepolia (`BASE_NETWORK=testnet`)
- USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle)
- Signer: `BASE_SIGNER_KEY` → `0x047782D3BAa31aEEBe682A6705FeBCB275b96dc9`
  (funded with 0.1 ETH + 20 USDC via Circle faucet)
- Login faucet: first Privy wallet → `POST /api/wallet/faucet` sends **2 USDC** once
- Balance: `GET /api/wallet/balance?wallet=0x…` · shown in workspace block
- Payout: `bun scripts/payout-usdc.ts [INQ-…] [--dry]` after GenLayer `payout_ready`
- Specialists register with `"private": true` (agents.visibility)

**USDC payouts DONE** (2026-09-16) for `INQ-mtzgdlgzicft`:
7/7 paid, $12.01 total, 0 failed. Signer remaining ~10 USDC.

## Out of scope (intentionally)

- Buyer refunds / need-scores / human protection on GenLayer
- Binance market check / priced-in candles
- Specialist agent routing
- OpenCode Zen

## Next

- Fresh live inquiry end-to-end: claim → GenLayer settle → USDC payout → login faucet
- Tighten agent claim quality (street/site/contact, not bare 8-K lines)
- Top up signer when USDC drops under ~6 (need faucet grants + next pool)
