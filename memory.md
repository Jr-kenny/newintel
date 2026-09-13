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
4. Bradbury writes **flake** — retry findings; fail closed if final/adjudicate fail
5. Bun scripts need a **full genlayer path** (fnm shim not on default PATH)

## Live run

`INQ-mtzgdlgzicft` — packaging/cold-chain West Africa  
30 claims · 27 clusters · report written · settlement rows in local DB  
(chain adjudicate for that id was pre-deterministic-contract)

## Out of scope (intentionally)

- Buyer refunds / need-scores / human protection on GenLayer
- Binance market check / priced-in candles
- Specialist agent routing
- OpenCode Zen

## Next

- Fresh live run end-to-end through **required** GenLayer settle
- USDC transfers on Base once weights are chain-final
- Tighten agent claim quality (street/site/contact, not bare 8-K lines)
