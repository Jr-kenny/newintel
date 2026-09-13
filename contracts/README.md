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

Bradbury (current CLI network). Latest address is in `.env` as
`GENLAYER_JUDGE_ADDRESS`.

1. Claim POST → `record_finding`
2. After report → `record_final` (same package the business got — matching input only)
3. `adjudicate` → `weights` → agent payouts
