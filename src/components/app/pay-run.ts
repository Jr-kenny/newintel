/**
 * Browser-side USDC payment for one inquiry run.
 * Sends RUN_PRICE_USD USDC from the Privy wallet to the platform treasury
 * on Base Sepolia, then returns the tx hash for server verification.
 */

import type { ConnectedWallet } from "@privy-io/react-auth";

const BASE_SEPOLIA_CHAIN_ID = 84532;
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

function padAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function padAmount(units: bigint): string {
  return units.toString(16).padStart(64, "0");
}

export type PayRunResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string };

export async function payRunFeeUsdc(input: {
  wallet: ConnectedWallet;
  amountUsd: number;
}): Promise<PayRunResult> {
  try {
    const metaRes = await fetch("/api/wallet/meta");
    if (!metaRes.ok) return { ok: false, error: "payment config unavailable" };
    const meta = (await metaRes.json()) as {
      chainId: number;
      usdc: string;
      signer: string | null;
      ready: boolean;
    };
    if (!meta.signer) return { ok: false, error: "payment treasury not configured" };
    if (!meta.ready) return { ok: false, error: "payment rail offline" };

    const chainId = meta.chainId || BASE_SEPOLIA_CHAIN_ID;
    try {
      await input.wallet.switchChain(chainId);
    } catch {
      // already on the chain, or wallet will prompt
    }

    const provider = await input.wallet.getEthereumProvider();
    const { ethers } = await import("ethers");
    const browser = new ethers.BrowserProvider(provider as never);
    const signer = await browser.getSigner();

    // USDC on Base Sepolia has 6 decimals.
    const units = BigInt(Math.round(input.amountUsd * 1e6));
    const data = `${ERC20_TRANSFER_SELECTOR}${padAddress(meta.signer)}${padAmount(units)}`;

    const tx = await signer.sendTransaction({
      to: meta.usdc,
      data: data as `0x${string}`,
      value: 0n,
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      return { ok: false, error: "USDC payment reverted" };
    }
    return { ok: true, txHash: receipt.hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/user rejected|denied/i.test(msg)) {
      return { ok: false, error: "payment cancelled" };
    }
    if (/insufficient funds|gas/i.test(msg)) {
      return {
        ok: false,
        error: "not enough ETH for gas — claim the login faucet for testnet gas",
      };
    }
    return { ok: false, error: "USDC payment failed — try again" };
  }
}
