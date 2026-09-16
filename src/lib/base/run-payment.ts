/**
 * Verify a workspace USDC payment for an inquiry on Base Sepolia.
 * The client sends RUN_PRICE_USD USDC to the platform treasury; we
 * re-read the Transfer on chain. The HTTP body is never trusted alone.
 */

import { baseConfig, baseExplorerTx } from "./config";
import { usdcAddress, usdToUnits } from "./usdc";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type PaymentCheck =
  | { ok: true; txHash: string; from: string; amountUsd: number; explorerUrl: string }
  | { ok: false; error: string };

/** Address that receives run fees. Platform hot wallet on Base. */
export function runTreasuryAddress(): string | null {
  return baseConfig().walletAddress ?? null;
}

export async function verifyRunPayment(input: {
  txHash: string;
  /** Workspace wallet that should have paid. */
  from: string;
  minAmountUsd?: number;
}): Promise<PaymentCheck> {
  const txHash = input.txHash.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
    return { ok: false, error: "invalid payment transaction hash" };
  }
  const from = input.from.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(from)) {
    return { ok: false, error: "workspace wallet missing — connect a wallet and pay again" };
  }
  const treasury = runTreasuryAddress();
  if (!treasury) {
    return { ok: false, error: "payment treasury not configured" };
  }
  const minUsd = input.minAmountUsd ?? 1;
  const minUnits = usdToUnits(minUsd);

  try {
    const { ethers } = await import("ethers");
    const config = baseConfig();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      return { ok: false, error: "payment not confirmed on Base yet — wait a few seconds and retry" };
    }

    const token = usdcAddress().toLowerCase();
    const to = treasury.toLowerCase();
    let paid = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== token) continue;
      if ((log.topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
      if (log.topics.length < 3) continue;
      const logFrom = ethers.getAddress(`0x${log.topics[1]!.slice(26)}`).toLowerCase();
      const logTo = ethers.getAddress(`0x${log.topics[2]!.slice(26)}`).toLowerCase();
      if (logFrom !== from || logTo !== to) continue;
      paid += BigInt(log.data);
    }

    if (paid < minUnits) {
      return {
        ok: false,
        error: `payment too small — need at least ${minUsd} USDC to ${treasury.slice(0, 10)}…`,
      };
    }

    const decimals = 6;
    return {
      ok: true,
      txHash: receipt.hash ?? txHash,
      from,
      amountUsd: Number(paid) / 10 ** decimals,
      explorerUrl: baseExplorerTx(receipt.hash ?? txHash, config.network),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: msg.includes("failed to detect network")
        ? "Base RPC unavailable — try again"
        : "could not verify payment on chain",
    };
  }
}
