/**
 * Login faucet — one-time 2 USDC on Base Sepolia for every new workspace
 * wallet. Enough for two paid inquiry runs at the current pool share.
 *
 * Trigger: first authenticated Privy session with an embedded wallet.
 * Source: BASE_SIGNER_KEY hot wallet funded off-app (Circle faucet / transfer).
 */

import { db, ensureSchema, nowIso } from "@/lib/db";
import { faucetClaims } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUsdcBalance, sendUsdc, usdcReady } from "./usdc";

/** Two full runs at the demo pool price. */
export const FAUCET_USDC = 2;

export type FaucetResult =
  | { ok: true; alreadyClaimed: true; txHash: string; amount: number }
  | { ok: true; alreadyClaimed: false; txHash: string; amount: number; explorerUrl: string }
  | { ok: false; error: string };

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

export async function claimFaucet(input: {
  wallet: string;
  identity?: string | null;
}): Promise<FaucetResult> {
  const wallet = normalizeWallet(input.wallet);
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return { ok: false, error: "invalid wallet address" };
  }

  await ensureSchema();
  const [existing] = await db
    .select()
    .from(faucetClaims)
    .where(eq(faucetClaims.wallet, wallet))
    .limit(1);

  if (existing?.txHash) {
    return {
      ok: true,
      alreadyClaimed: true,
      txHash: existing.txHash,
      amount: existing.amountUsd,
    };
  }

  if (!usdcReady()) {
    return { ok: false, error: "faucet offline — BASE_SIGNER_KEY not configured" };
  }

  // Reserve the claim row before the transfer so a double-click cannot
  // double-send. Clear the row if the transfer fails so they can retry.
  if (existing) {
    await db
      .update(faucetClaims)
      .set({ status: "pending", identity: input.identity ?? existing.identity, attemptedAt: nowIso() })
      .where(eq(faucetClaims.wallet, wallet));
  } else {
    await db.insert(faucetClaims).values({
      wallet,
      identity: input.identity ?? null,
      amountUsd: FAUCET_USDC,
      status: "pending",
      attemptedAt: nowIso(),
      createdAt: nowIso(),
    });
  }

  try {
    const sent = await sendUsdc(wallet, FAUCET_USDC);
    await db
      .update(faucetClaims)
      .set({
        status: "sent",
        txHash: sent.txHash,
        amountUsd: sent.amount,
        tokenAddress: sent.token,
        sentAt: nowIso(),
      })
      .where(eq(faucetClaims.wallet, wallet));
    return {
      ok: true,
      alreadyClaimed: false,
      txHash: sent.txHash,
      amount: sent.amount,
      explorerUrl: sent.explorerUrl,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(faucetClaims)
      .set({ status: "failed", error: message.slice(0, 300) })
      .where(eq(faucetClaims.wallet, wallet));
    return { ok: false, error: message };
  }
}

export async function faucetStatus(wallet: string): Promise<{
  claimed: boolean;
  amount: number | null;
  txHash: string | null;
}> {
  await ensureSchema();
  const [row] = await db
    .select()
    .from(faucetClaims)
    .where(eq(faucetClaims.wallet, normalizeWallet(wallet)))
    .limit(1);
  return {
    claimed: Boolean(row?.txHash),
    amount: row?.amountUsd ?? null,
    txHash: row?.txHash ?? null,
  };
}

export async function walletBalances(wallet: string): Promise<{
  usdc: number;
  eth: string;
  network: string;
  faucet: { claimed: boolean; amount: number | null; txHash: string | null };
  ready: boolean;
}> {
  const address = normalizeWallet(wallet);
  const faucet = await faucetStatus(address);
  if (!usdcReady()) {
    return { usdc: 0, eth: "0", network: "testnet", faucet, ready: false };
  }
  try {
    const [usdc, { getNativeBalance }] = await Promise.all([
      getUsdcBalance(address),
      import("./usdc"),
    ]);
    const ethWei = await getNativeBalance(address);
    const { formatEther } = await import("ethers");
    return {
      usdc: usdc.amount,
      eth: formatEther(ethWei),
      network: usdc.network,
      faucet,
      ready: true,
    };
  } catch (err) {
    console.error("walletBalances failed:", err);
    return { usdc: 0, eth: "0", network: "testnet", faucet, ready: false };
  }
}
