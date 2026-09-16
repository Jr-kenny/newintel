/**
 * Pay agent settlements in USDC on Base.
 *
 * Hard gate: only rows already written by settle-from-weights (which
 * required GenLayer payout_ready). Skips placeholder wallets and any
 * row that already has payout_tx.
 *
 *   bun scripts/payout-usdc.ts                 # all unpaid
 *   bun scripts/payout-usdc.ts INQ-…           # one inquiry
 *   bun scripts/payout-usdc.ts --dry           # preview only
 */
import { db, ensureSchema, nowIso } from "../src/lib/db";
import { settlements, agents } from "../src/lib/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { sendUsdc, usdcReady, baseSignerAddress, getUsdcBalance } from "../src/lib/base/usdc";
import { isPlaceholderWallet } from "../src/lib/base/wallets";
import { baseConfig } from "../src/lib/base/config";
import { payoutReady } from "../src/lib/genlayer/judge";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const inquiryFilter = args.find((a) => !a.startsWith("--"));

if (!usdcReady()) {
  console.error("FATAL: BASE_SIGNER_KEY not set — cannot pay USDC");
  process.exit(1);
}

const config = baseConfig();
console.log("network", config.network, "chain", config.chainId);
console.log("signer", baseSignerAddress());
await ensureSchema();

const filters = [or(isNull(settlements.payoutTx), eq(settlements.payoutTx, ""))];
if (inquiryFilter) filters.push(eq(settlements.inquiryId, inquiryFilter));

const rows = await db
  .select()
  .from(settlements)
  .where(and(...filters))
  .orderBy(settlements.createdAt);

if (rows.length === 0) {
  console.log("no unpaid settlements");
  process.exit(0);
}

// Group by inquiry so we re-check payout_ready once per batch.
const byInquiry = new Map<string, typeof rows>();
for (const r of rows) {
  const list = byInquiry.get(r.inquiryId) ?? [];
  list.push(r);
  byInquiry.set(r.inquiryId, list);
}

console.log(`${rows.length} unpaid settlements across ${byInquiry.size} inquiries\n`);

let paid = 0;
let skipped = 0;
let failed = 0;
let totalUsd = 0;

for (const [inquiryId, list] of byInquiry) {
  const ready = await payoutReady(inquiryId);
  if (!ready) {
    console.error(`SKIP ${inquiryId}: payout_ready=false on GenLayer`);
    skipped += list.length;
    continue;
  }
  console.log(`${inquiryId} payout_ready=true · ${list.length} rows`);

  for (const row of list) {
    const wallet = row.wallet;
    if (!wallet || isPlaceholderWallet(wallet)) {
      console.log(`  skip ${row.agentId} placeholder wallet ${wallet}`);
      skipped++;
      continue;
    }
    if (row.amountUsd <= 0) {
      console.log(`  skip ${row.agentId} amount=${row.amountUsd}`);
      skipped++;
      continue;
    }

    if (dry) {
      console.log(`  DRY $${row.amountUsd.toFixed(2)} → ${wallet} (${row.agentId})`);
      continue;
    }

    try {
      const sent = await sendUsdc(wallet, row.amountUsd);
      await db
        .update(settlements)
        .set({
          payoutTx: sent.txHash,
          paidNative: sent.amount,
          payoutError: null,
          tx: sent.txHash,
        })
        .where(eq(settlements.id, row.id));
      // Touch agent wallet in case it drifted.
      await db.update(agents).set({ wallet }).where(eq(agents.id, row.agentId));
      paid++;
      totalUsd += sent.amount;
      console.log(
        `  PAID $${sent.amount.toFixed(2)} ${sent.txHash.slice(0, 14)}… → ${wallet}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(settlements)
        .set({ payoutError: message.slice(0, 300) })
        .where(eq(settlements.id, row.id));
      failed++;
      console.error(`  FAIL ${row.agentId} ${wallet}: ${message.slice(0, 160)}`);
    }
    // Pace so the shared nonce does not collide under load.
    await new Promise((r) => setTimeout(r, 400));
  }
}

console.log("\n=== payout summary ===");
console.log({ paid, skipped, failed, totalUsd, dry, at: nowIso() });

if (!dry && baseSignerAddress()) {
  try {
    const bal = await getUsdcBalance(baseSignerAddress()!);
    console.log(`signer USDC remaining: ${bal.amount.toFixed(2)}`);
  } catch {
    // ignore
  }
}

if (failed > 0) process.exit(1);
