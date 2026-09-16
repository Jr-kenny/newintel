/**
 * Bridge USDC from Arc Testnet → Base Sepolia via Circle CCTP V2.
 *
 * Operator flow:
 *   1. Send Arc Testnet USDC to BASE_SIGNER_KEY address (0x0477…6dc9)
 *   2. bun scripts/bridge-arc-to-base.ts          # drain Arc USDC → Base
 *   3. bun scripts/bridge-arc-to-base.ts --amount 20
 *
 * Arc Testnet
 *   chainId 5042002 · RPC https://rpc.testnet.arc.io
 *   USDC ERC-20 0x3600000000000000000000000000000000000000 (6 dec)
 *   Native gas is USDC (18-dec native) — keep a little for gas
 *   TokenMessengerV2 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA (domain 26)
 *
 * Base Sepolia
 *   chainId 84532 · USDC 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *   TokenMessengerV2 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA (domain 16)
 *   MessageTransmitterV2 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
 *
 * Fast CCTP (~8-20s). Standard takes ~15-19 min.
 */
import { Wallet, JsonRpcProvider, Contract, formatUnits, parseUnits } from "ethers";

const ARC_RPC = process.env["ARC_RPC_URL"]?.trim() || "https://rpc.testnet.arc.io";
const BASE_RPC = process.env["BASE_RPC_URL"]?.trim() || "https://sepolia.base.org";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const BASE_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ARC_TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const BASE_TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const BASE_MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const ARC_DOMAIN = 26;
const BASE_DOMAIN = 16;
const IRIS = "https://iris-api-sandbox.circle.com";

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

// CCTP TokenMessengerV2.depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint32 maxFee, uint32 minFinalityThreshold)
const MESSENGER = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint32 maxFee, uint32 minFinalityThreshold) returns (uint64 nonce)",
];

const TRANSMITTER = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
];

function toBytes32(address: string): string {
  return `0x${address.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
}

async function main() {
  const key = process.env["BASE_SIGNER_KEY"]?.trim();
  if (!key) {
    console.error("FATAL: BASE_SIGNER_KEY not set");
    process.exit(1);
  }
  const argAmount = process.argv.find((a) => a.startsWith("--amount="))?.split("=")[1];
  const amountFlag = process.argv.indexOf("--amount");
  const amountArg =
    argAmount ?? (amountFlag >= 0 ? process.argv[amountFlag + 1] : undefined);

  const arcProvider = new JsonRpcProvider(ARC_RPC, 5042002);
  const baseProvider = new JsonRpcProvider(BASE_RPC, 84532);
  const wallet = new Wallet(key, arcProvider);
  const baseWallet = wallet.connect(baseProvider);

  console.log("signer", wallet.address);
  console.log("arc rpc", ARC_RPC);

  const usdc = new Contract(ARC_USDC, ERC20, wallet);
  const decimals = Number(await usdc.decimals());
  const rawBal: bigint = await usdc.balanceOf(wallet.address);
  const bal = Number(rawBal) / 10 ** decimals;
  console.log(`Arc USDC (erc20): ${bal}`);

  const native = await arcProvider.getBalance(wallet.address);
  console.log(`Arc native gas (USDC 18dec): ${formatUnits(native, 18)}`);

  if (rawBal === 0n) {
    console.error("No Arc USDC to bridge. Send USDC to", wallet.address, "on Arc Testnet first.");
    process.exit(1);
  }

  let amountUnits = rawBal;
  if (amountArg) {
    amountUnits = parseUnits(amountArg, decimals);
    if (amountUnits > rawBal) {
      console.error(`--amount ${amountArg} exceeds balance ${bal}`);
      process.exit(1);
    }
  } else {
    // Leave a tiny dust so we don't strand the last wei if needed.
    if (rawBal > 1_000n) amountUnits = rawBal - 1_000n;
  }

  const amountHuman = Number(amountUnits) / 10 ** decimals;
  console.log(`\nBridging ${amountHuman} USDC Arc → Base Sepolia (CCTP V2 fast)…`);

  const messenger = new Contract(ARC_TOKEN_MESSENGER, MESSENGER, wallet);
  const mintRecipient = toBytes32(wallet.address);
  const destinationCaller = toBytes32("0x0000000000000000000000000000000000000000");
  const maxFee = 500n; // fast transfer fee budget in USDC units (tiny)
  const minFinality = 2000; // fast (2000) vs standard (2000); check docs — 2000 is confirmed fast

  // Approve messenger
  const allowance: bigint = await usdc.allowance(wallet.address, ARC_TOKEN_MESSENGER);
  if (allowance < amountUnits) {
    console.log("approve…");
    const approveTx = await usdc.approve(ARC_TOKEN_MESSENGER, amountUnits);
    await approveTx.wait();
    console.log("approved", approveTx.hash);
  }

  console.log("depositForBurn…");
  const burnTx = await messenger.depositForBurn(
    amountUnits,
    BASE_DOMAIN,
    mintRecipient,
    ARC_USDC,
    destinationCaller,
    maxFee,
    minFinality,
  );
  console.log("burn tx", burnTx.hash);
  const burnRc = await burnTx.wait();
  console.log("burn confirmed block", burnRc.blockNumber);

  // Extract nonce from MessageSent event (topic) or from receipt
  // Iris poll by transaction hash + source domain
  const burnHash = burnTx.hash;
  console.log("\nWaiting for Circle attestation (Iris)…");
  let attestation: string | null = null;
  let message: string | null = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    try {
      const res = await fetch(
        `${IRIS}/v2/messages/${ARC_DOMAIN}?transactionHash=${burnHash}`,
      );
      if (res.status === 200) {
        const data = (await res.json()) as {
          messages?: {
            attestation?: string;
            message?: string;
            status?: string;
          }[];
        };
        const msg = data.messages?.[0];
        if (msg?.attestation && msg.attestation !== "PENDING") {
          attestation = msg.attestation;
          message = msg.message;
          console.log("attestation ready, status", msg.status);
          break;
        }
        console.log(`  iris status ${msg?.status ?? "unknown"}… (${i + 1})`);
      } else {
        console.log(`  iris http ${res.status}… (${i + 1})`);
      }
    } catch (err) {
      console.log("  iris poll error", err instanceof Error ? err.message : err);
    }
  }
  if (!attestation || !message) {
    console.error("No attestation yet. Retry later with:");
    console.error(`  bun scripts/bridge-arc-to-base.ts --resume ${burnHash}`);
    process.exit(1);
  }

  console.log("mint on Base Sepolia…");
  const transmitter = new Contract(BASE_MESSAGE_TRANSMITTER, TRANSMITTER, baseWallet);
  const mintTx = await transmitter.receiveMessage(message, attestation);
  console.log("mint tx", mintTx.hash);
  await mintTx.wait();

  const baseUsdc = new Contract(BASE_USDC, ERC20, baseProvider);
  const after: bigint = await baseUsdc.balanceOf(wallet.address);
  console.log("\nDONE");
  console.log("Base USDC balance:", formatUnits(after, 6));
  console.log("burn", `https://testnet.arcscan.app/tx/${burnHash}`);
  console.log("mint", `https://sepolia.basescan.org/tx/${mintTx.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
