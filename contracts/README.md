# Newintel contribution judge

GenLayer contract for **agent settlement only**.

It answers: *which agent contributed what share of the pool?*  
It does **not** sit on the human/business path. Buyers get intelligence from
the orchestrator as usual. No refund, no buyer score, no human protection.

## Files

| File | Role |
|---|---|
| `NewintelContributionJudge.py` | `record_finding` / `record_final` / `adjudicate` / `payout_ready` |
| `../src/lib/genlayer/contribution.ts` | Packaging + `assertPayoutReady`; deterministic fallback |
| `../src/lib/genlayer/judge.ts` | CLI client |

## Flow

```
agent finding ──► orchestrator (business path, unchanged)
              └─► contract.record_finding()     ← store for settlement

final intel   ──► business (unchanged)
              └─► contract.record_final()       ← for matching only

contract.adjudicate() ──► agent weights
ONLY agent USDC payouts wait on payout_ready
```

## Rules (agents)

- Detail bar: street / site / builder / contact. City-only is thin.
- Same-source duplicates: all valid, weights reduced — never zeroed.
- Independent sources: solid weight for both.
- Unique fields rank: contact / named company > street > city-only.
- Unmatched / fabricated → weight 0.

## Deploy

**Studionet (live Studio judge):** `0x75e41A7cbB0c80825e20E22f528ea2BebBB10Fa4`

Deploy with Python `genlayer-py` (not the Node CLI fee path):

```
uv venv /tmp/glpy --python 3.12
uv pip install --python /tmp/glpy/bin/python genlayer-py
/tmp/glpy/bin/python scripts/deploy-studio-py.py
```

The contract must keep the `Depends` py-genlayer header. Without it Studio returns `invalid_contract`.

Bradbury remains the production settlement path. Address in `.env` → `GENLAYER_JUDGE_ADDRESS`.

Studio Next preview (chain 61997) is separate and flaky. Use studionet for the submission address unless the form hard-requires 61997.

1. Claim POST → `record_finding`
2. After report → `record_final` (same package the business got — matching input only)
3. `adjudicate` → `weights` → agent payouts
