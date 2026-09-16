/**
 * Login faucet — 2 USDC plus gas dust on Base Sepolia for every new
 * workspace wallet. That USDC is what pays for inquiry runs. The gas
 * dust lets the embedded wallet actually send the ERC-20 transfer.
 */

import { db, ensureSchema, nowIso } from "@/lib/db";
import { faucetClaims } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUsdcBalance, sendUsdc, usdcReady } from "./usdc";

/** Two full runs at the demo pool price. */
export const FAUCET_USDC = 2;
/** Gas dust so the workspace can actually send USDC for a run. */
export const FAUCET_ETH = "0.001";

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
    // Workspace needs ETH gas to transfer USDC for a paid run.
    let gasTx: string | null = null;
    try {
      const { ethers } = await import("ethers");
      const { baseConfig } = await import("./config");
      const config = baseConfig();
      if (config.privateKey) {
        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
        const signer = new ethers.Wallet(config.privateKey, provider);
        const gas = await signer.sendTransaction({
          to: wallet,
          value: ethers.parseEther(FAUCET_ETH),
        });
        await gas.wait();
        gasTx = gas.hash;
      }
    } catch (err) {
      console.error("faucet gas send failed:", err);
    }
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
    // Login faucet is USDC for paid runs. No free-trial credit grant.
    void gasTx;
    return {
      ok: true,
      alreadyClaimed: false,
      txHash: sent.txHash,
      amount: sent.amount,
      explorerUrl: sent.explorerUrl,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    await db
      .update(faucetClaims)
      .set({ status: "failed", error: raw.slice(0, 300) })
      .where(eq(faucetClaims.wallet, wallet));
    return { ok: false, error: friendlyFaucetError(raw) };
  }
}

/** Never surface raw RPC/revert dumps in the UI. */
export function friendlyFaucetError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("transfer amount exceeds balance") || m.includes("insufficient")) {
    return "Faucet is empty right now. Try again after the sponsor tank is topped up.";
  }
  if (m.includes("needs base eth") || m.includes("gas")) {
    return "Sponsor wallet needs gas. Ping the operator.";
  }
  if (m.includes("timeout") || m.includes("econnrefused") || m.includes("network")) {
    return "Faucet network hiccup. Try again in a moment.";
  }
  if (m.includes("already claimed") || m.includes("alreadyClaimed")) {
    return "This wallet already claimed its 2 USDC.";
  }
  return "Faucet unavailable. Your wallet address still works — fund it manually if you have Base USDC.";
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
