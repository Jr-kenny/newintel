/**
 * HTTP surface for the login faucet, wallet balance, and the GenLayer
 * web-oracle payout relayer.
 *
 *  POST /api/wallet/faucet         { wallet, identity? }
 *  GET  /api/wallet/balance?wallet=0x…
 *  POST /api/wallet/relay-payout   { inquiry_id, weights }  ← from GenLayer IC
 */

import { z } from "zod";
import { claimFaucet, walletBalances, FAUCET_USDC } from "@/lib/base/faucet";
import { baseSignerAddress, usdcAddress, usdcReady } from "@/lib/base/usdc";
import { baseConfig } from "@/lib/base/config";
import { relayPayout } from "@/lib/base/relay-payout";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
    },
  });

const faucetSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "wallet must be an EVM address"),
  identity: z.string().max(200).optional(),
});

const relaySchema = z.object({
  inquiry_id: z.string().min(3).max(80),
  weights: z.record(z.string(), z.number()).optional(),
  ready: z.boolean().optional(),
  judge: z.string().max(80).optional(),
});

export async function handleWalletApi(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/wallet/balance") {
    const wallet = url.searchParams.get("wallet")?.trim();
    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return json({ error: "wallet query param required" }, 400);
    }
    const balances = await walletBalances(wallet);
    return json(balances);
  }

  if (request.method === "GET" && url.pathname === "/api/wallet/meta") {
    const config = baseConfig();
    return json({
      network: config.network,
      chainId: config.chainId,
      explorer: config.explorer,
      usdc: usdcAddress(),
      faucetAmount: FAUCET_USDC,
      signer: baseSignerAddress(),
      ready: usdcReady(),
      relay: "/api/wallet/relay-payout",
    });
  }

  if (request.method === "POST" && url.pathname === "/api/wallet/faucet") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const parsed = faucetSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
    }
    const result = await claimFaucet({
      wallet: parsed.data.wallet,
      identity: parsed.data.identity ?? null,
    });
    return json(result, result.ok ? 200 : 502);
  }

  // GenLayer Intelligent Contract web-oracle target.
  if (request.method === "POST" && url.pathname === "/api/wallet/relay-payout") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const parsed = relaySchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
    }
    const result = await relayPayout({
      inquiryId: parsed.data.inquiry_id,
      claimedWeights: parsed.data.weights ?? null,
    });
    // 200 even on "refuse" so consensus doesn't brick — the contract
    // still has payout_ready. Only 5xx when the relayer itself crashed.
    return json(result, 200);
  }

  return json({ error: "Not found" }, 404);
}
