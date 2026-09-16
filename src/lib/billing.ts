/**
 * Run billing for the business workspace.
 *
 * Customers pay in USDC on Base Sepolia. The login faucet exists so a new
 * workspace has both USDC (to pay for runs) and a little ETH (to send it).
 * GenLayer only splits the contributor pool that those fees fund.
 */

import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import { accounts, creditLedger, inquiries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** What the workspace wallet must send to the treasury per run. */
export const RUN_PRICE_USD = 1;
export const POOL_SHARE = 0.6;
/** Free trials are off — paid USDC is the path. */
export const FREE_TRIAL_RUNS = 0;
export const FAUCET_RUN_CREDITS = 0;

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
  return { id, identity, credits: 0, freeRunsUsed: 0, freeRunsLeft: FREE_TRIAL_RUNS };
}

export type ConsumeResult =
  | {
      ok: true;
      kind: "usdc" | "credit";
      creditsLeft: number;
      freeRunsLeft: number;
      txHash?: string;
    }
  | { ok: false; error: string };

/**
 * Record a paid run. Requires a verified Base USDC payment for signed-in
 * workspaces. Legacy prepaid credits still work if a paymentTx is absent
 * (should not happen on new flows).
 */
export async function consumeRunCredit(input: {
  identity: string;
  inquiryId: string;
  email?: string | null;
  wallet?: string | null;
  paymentTx?: string | null;
}): Promise<ConsumeResult> {
  await ensureSchema();
  const account = await ensureAccount(input);

  if (input.paymentTx) {
    await db.insert(creditLedger).values({
      accountId: account.id,
      delta: 0,
      kind: "run_payment",
      inquiryId: input.inquiryId,
      txHash: input.paymentTx,
      paidNative: RUN_PRICE_USD,
      createdAt: nowIso(),
    });
    return {
      ok: true,
      kind: "usdc",
      creditsLeft: account.credits,
      freeRunsLeft: account.freeRunsLeft,
      txHash: input.paymentTx,
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
    return { ok: true, kind: "credit", creditsLeft: left, freeRunsLeft: 0 };
  }

  return {
    ok: false,
    error: `Pay ${RUN_PRICE_USD} USDC on Base Sepolia to open this run. Claim the login faucet if you need testnet USDC and gas.`,
  };
}

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

export async function stampRunEconomics(
  inquiryId: string,
  paymentTx?: string | null,
): Promise<void> {
  await ensureSchema();
  await db
    .update(inquiries)
    .set({
      runFeeUsd: RUN_PRICE_USD,
      poolUsd: poolUsdForRun(),
      paymentTx: paymentTx ?? null,
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
