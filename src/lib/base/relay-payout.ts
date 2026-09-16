/**
 * GenLayer → Base payout relayer.
 *
 * The Intelligent Contract's `request_payout` web-oracle POSTs here under
 * consensus. We NEVER trust the POST body alone — we re-read `get_verdict`
 * and `payout_ready` from Bradbury, then send USDC to agent wallets.
 *
 * Weights stay on GenLayer. Base only executes what consensus already
 * recorded.
 */

import { db, ensureSchema, nowIso } from "@/lib/db";
import { agents, settlements } from "@/lib/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { getVerdict, payoutReady } from "@/lib/genlayer/judge";
import { sendUsdc, usdcReady, baseSignerAddress } from "@/lib/base/usdc";
import { isPlaceholderWallet } from "@/lib/base/wallets";

export type RelayPayoutResult = {
  ok: boolean;
  inquiryId: string;
  paid: number;
  skipped: number;
  failed: number;
  totalUsd: number;
  txs: { agentId: string; wallet: string; amount: number; txHash: string }[];
  note: string;
  at: string;
};

function parseVerdictWeights(raw: string | null): Record<string, number> | null {
  if (!raw) return null;
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const data = JSON.parse(raw.slice(start, end + 1)) as {
        weights?: Record<string, number>;
        ready?: boolean;
      };
      if (data.weights && Object.keys(data.weights).length > 0) return data.weights;
    }
  } catch {
    // fall through
  }
  const m = raw.match(/"weights"\s*:\s*\{[^}]+\}/);
  if (m) {
    try {
      const data = JSON.parse(`{${m[0]}}`) as { weights: Record<string, number> };
      if (data.weights) return data.weights;
    } catch {
      // ignore
    }
  }
  return null;
}

export async function relayPayout(input: {
  inquiryId: string;
  /** Weights from the web-oracle body — advisory only; chain wins. */
  claimedWeights?: Record<string, number> | null;
}): Promise<RelayPayoutResult> {
  const inquiryId = input.inquiryId.trim();
  const empty: Omit<RelayPayoutResult, "ok" | "note"> = {
    inquiryId,
    paid: 0,
    skipped: 0,
    failed: 0,
    totalUsd: 0,
    txs: [],
    at: nowIso(),
  };

  if (!inquiryId) {
    return { ...empty, ok: false, note: "missing inquiry_id" };
  }
  if (!usdcReady()) {
    return { ...empty, ok: false, note: "BASE_SIGNER_KEY not configured" };
  }

  // Hard gate: re-read GenLayer. Body weights are never sufficient.
  const ready = await payoutReady(inquiryId);
  if (!ready) {
    return { ...empty, ok: false, note: "payout_ready=false on GenLayer — refuse" };
  }
  const verdictRaw = await getVerdict(inquiryId);
  const milli = parseVerdictWeights(verdictRaw);
  if (!milli || Object.keys(milli).length === 0) {
    return { ...empty, ok: false, note: "no weights on chain — refuse" };
  }

  await ensureSchema();
  const rows = await db
    .select()
    .from(settlements)
    .where(
      and(
        eq(settlements.inquiryId, inquiryId),
        or(isNull(settlements.payoutTx), eq(settlements.payoutTx, "")),
      ),
    );

  if (rows.length === 0) {
    // Settlements may not be written yet — caller should have run
    // settle-from-weights first. Still return 200 so consensus succeeds.
    return {
      ...empty,
      ok: true,
      note: "payout_ready but no unpaid local settlements (run settle first)",
    };
  }

  const agentRows = await db.select().from(agents);
  const txs: RelayPayoutResult["txs"] = [];
  let paid = 0;
  let skipped = 0;
  let failed = 0;
  let totalUsd = 0;

  for (const row of rows) {
    if (!row.wallet || isPlaceholderWallet(row.wallet) || row.amountUsd <= 0) {
      skipped++;
      continue;
    }
    // Only pay agents that appear in the on-chain verdict.
    const chainMilli = milli[row.agentId];
    if (chainMilli === undefined || Number(chainMilli) <= 0) {
      skipped++;
      continue;
    }
    try {
      const sent = await sendUsdc(row.wallet, row.amountUsd);
      await db
        .update(settlements)
        .set({
          payoutTx: sent.txHash,
          paidNative: sent.amount,
          payoutError: null,
          tx: sent.txHash,
        })
        .where(eq(settlements.id, row.id));
      await db.update(agents).set({ wallet: row.wallet }).where(eq(agents.id, row.agentId));
      paid++;
      totalUsd += sent.amount;
      txs.push({
        agentId: row.agentId,
        wallet: row.wallet,
        amount: sent.amount,
        txHash: sent.txHash,
      });
      void agentRows;
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(settlements)
        .set({ payoutError: message.slice(0, 300) })
        .where(eq(settlements.id, row.id));
    }
  }

  const ok = failed === 0;
  return {
    ...empty,
    ok,
    paid,
    skipped,
    failed,
    totalUsd,
    txs,
    note: ok
      ? `relay paid ${paid} agent wallets from GenLayer verdict`
      : `relay partial: paid=${paid} failed=${failed}`,
    at: nowIso(),
  };
}

export function relaySigner(): string | null {
  return baseSignerAddress();
}
