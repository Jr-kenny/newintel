/**
 * HTTP surface for the login faucet and wallet balance.
 * Privy session wallets call these from the workspace block.
 *
 *  POST /api/wallet/faucet   { wallet, identity? }
 *  GET  /api/wallet/balance?wallet=0x…
 */

import { z } from "zod";
import { claimFaucet, walletBalances, FAUCET_USDC } from "@/lib/base/faucet";
import { baseSignerAddress, usdcAddress, usdcReady } from "@/lib/base/usdc";
import { baseConfig } from "@/lib/base/config";

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

  return json({ error: "Not found" }, 404);
}
