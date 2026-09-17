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

Bradbury (live settlement path). Address in `.env` → `GENLAYER_JUDGE_ADDRESS`.

Studio Next (chain 61997, `studio-dev`): a Studio Next build lives in
`NewintelContributionJudge.studionext.py`. Use genlayer CLI `0.40.0-rc.3`:

```
npx genlayer@0.40.0-rc.3 network set studio-dev
npx genlayer@0.40.0-rc.3 estimate-fees --json
npx genlayer@0.40.0-rc.3 deploy --contract ./contracts/NewintelContributionJudge.studionext.py \
  --fees '<estimate.json>' --fee-value <estimate.feeValue>
```

Studio Next preview has been flaking: transactions can ACCEPT while leader
execution returns `FINISHED_WITH_ERROR`, so no contract address is created.
Retry when the preview is healthy. Production settlement stays on Bradbury.

1. Claim POST → `record_finding`
2. After report → `record_final` (same package the business got — matching input only)
3. `adjudicate` → `weights` → agent payouts
