/**
 * Bridge Arc Testnet USDC → Base Sepolia using Circle Bridge Kit (CCTP V2).
 *
 *   bun scripts/bridge-arc-to-base-kit.ts --amount=200
 */
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { ArcTestnet, BaseSepolia } from "@circle-fin/bridge-kit/chains";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) {
    return process.argv[i + 1];
  }
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.split("=")[1];
}

async function main() {
  const key = process.env["BASE_SIGNER_KEY"]?.trim();
  if (!key) {
    console.error("FATAL: BASE_SIGNER_KEY not set");
    process.exit(1);
  }

  const amount = arg("amount") ?? "200";
  const adapter = createViemAdapterFromPrivateKey({
    privateKey: key as `0x${string}`,
    capabilities: {
      addressContext: "user-controlled",
      supportedChains: [ArcTestnet, BaseSepolia],
    },
  });
  const kit = new BridgeKit({ adapter });

  console.log("Bridging", amount, "USDC Arc_Testnet → Base_Sepolia…");

  const result = await kit.bridge({
    from: { adapter, chain: "Arc_Testnet" },
    to: { adapter, chain: "Base_Sepolia" },
    amount,
    token: "USDC",
    config: { transferSpeed: "FAST" },
  });

  console.log("state", result.state);
  for (const step of result.steps ?? []) {
    console.log(
      `  ${step.name}: ${step.state}`,
      "txHash" in step && step.txHash ? step.txHash : "",
    );
  }
  if (result.state !== "success") {
    console.error(
      "bridge not success",
      JSON.stringify(result, null, 2).slice(0, 2500),
    );
    process.exit(1);
  }
  console.log("\nDONE — USDC should be on Base Sepolia");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
