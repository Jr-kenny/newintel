/**
 * Run billing for the business workspace.
 *
 * The GenLayer contract only splits the contributor pool. This module is
 * the other half: the customer spends a free trial or a credit, and that
 * run's fee is what funds the pool agents settle against.
 *
 * Demo economics kept consistent with settle-from-weights:
 *   run fee $20 · contributor pool 60% → $12 per cycle
 *   new workspace gets 2 free trial runs (matches the faucet story)
 */

import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import { accounts, creditLedger, inquiries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const RUN_PRICE_USD = 20;
export const POOL_SHARE = 0.6;
export const FREE_TRIAL_RUNS = 2;
/** Credits granted when the login faucet succeeds (one workspace). */
export const FAUCET_RUN_CREDITS = 2;

export function poolUsdForRun(): number {
  return Math.round(RUN_PRICE_USD * POOL_SHARE * 100) / 100;
}

export type AccountRow = {
  id: string;
  identity: string;
  credits: number;
  freeRunsUsed: number;
  freeRunsLeft: number;
};

export async function ensureAccount(input: {
  identity: string;
  email?: string | null;
  wallet?: string | null;
}): Promise<AccountRow> {
  await ensureSchema();
  const identity = input.identity.trim();
  const [existing] = await db.select().from(accounts).where(eq(accounts.identity, identity));
  if (existing) {
    if (input.wallet || input.email) {
      await db
        .update(accounts)
        .set({
          ...(input.email ? { email: input.email } : {}),
          ...(input.wallet ? { wallet: input.wallet } : {}),
          updatedAt: nowIso(),
        })
        .where(eq(accounts.id, existing.id));
    }
    return {
      id: existing.id,
      identity: existing.identity,
      credits: existing.credits,
      freeRunsUsed: existing.freeRunsUsed,
      freeRunsLeft: Math.max(0, FREE_TRIAL_RUNS - existing.freeRunsUsed),
    };
  }
  const id = newId("ACC");
  await db.insert(accounts).values({
    id,
    identity,
    email: input.email ?? null,
    wallet: input.wallet ?? null,
    credits: 0,
    freeRunsUsed: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  return {
    id,
    identity,
    credits: 0,
    freeRunsUsed: 0,
    freeRunsLeft: FREE_TRIAL_RUNS,
  };
}

export type ConsumeResult =
  | { ok: true; kind: "free" | "credit"; creditsLeft: number; freeRunsLeft: number }
  | { ok: false; error: string };

/**
 * Spend one free trial or one paid credit for an inquiry.
 * Call only after the inquiry row exists so the ledger can point at it.
 */
export async function consumeRunCredit(input: {
  identity: string;
  inquiryId: string;
  email?: string | null;
  wallet?: string | null;
}): Promise<ConsumeResult> {
  await ensureSchema();
  const account = await ensureAccount(input);

  if (account.freeRunsLeft > 0) {
    const used = account.freeRunsUsed + 1;
    await db
      .update(accounts)
      .set({ freeRunsUsed: used, updatedAt: nowIso() })
      .where(eq(accounts.id, account.id));
    await db.insert(creditLedger).values({
      accountId: account.id,
      delta: 0,
      kind: "free_run",
      inquiryId: input.inquiryId,
      createdAt: nowIso(),
    });
    return {
      ok: true,
      kind: "free",
      creditsLeft: account.credits,
      freeRunsLeft: Math.max(0, FREE_TRIAL_RUNS - used),
    };
  }

  if (account.credits > 0) {
    const left = account.credits - 1;
    await db
      .update(accounts)
      .set({ credits: left, updatedAt: nowIso() })
      .where(eq(accounts.id, account.id));
    await db.insert(creditLedger).values({
      accountId: account.id,
      delta: -1,
      kind: "run",
      inquiryId: input.inquiryId,
      createdAt: nowIso(),
    });
    return {
      ok: true,
      kind: "credit",
      creditsLeft: left,
      freeRunsLeft: 0,
    };
  }

  return {
    ok: false,
    error:
      "No runs left on this workspace. Free trial is used up and credits are empty. Claim the login faucet or top up to continue.",
  };
}

/** Add paid credits (top-up or faucet grant). */
export async function grantCredits(input: {
  identity: string;
  amount: number;
  kind: "topup" | "faucet";
  txHash?: string | null;
  email?: string | null;
  wallet?: string | null;
}): Promise<{ credits: number }> {
  if (input.amount <= 0) return { credits: 0 };
  await ensureSchema();
  const account = await ensureAccount(input);
  const credits = account.credits + input.amount;
  await db
    .update(accounts)
    .set({ credits, updatedAt: nowIso() })
    .where(eq(accounts.id, account.id));
  await db.insert(creditLedger).values({
    accountId: account.id,
    delta: input.amount,
    kind: input.kind === "faucet" ? "topup" : "run_payment",
    txHash: input.txHash ?? null,
    createdAt: nowIso(),
  });
  return { credits };
}

/** Stamp the commercial fee and agent pool onto the inquiry at open time. */
export async function stampRunEconomics(inquiryId: string): Promise<void> {
  await ensureSchema();
  await db
    .update(inquiries)
    .set({
      runFeeUsd: RUN_PRICE_USD,
      poolUsd: poolUsdForRun(),
      updatedAt: nowIso(),
    })
    .where(eq(inquiries.id, inquiryId));
}

export async function getAccountFor(identity: string): Promise<AccountRow | null> {
  await ensureSchema();
  const [row] = await db.select().from(accounts).where(eq(accounts.identity, identity));
  if (!row) return null;
  return {
    id: row.id,
    identity: row.identity,
    credits: row.credits,
    freeRunsUsed: row.freeRunsUsed,
    freeRunsLeft: Math.max(0, FREE_TRIAL_RUNS - row.freeRunsUsed),
  };
}
