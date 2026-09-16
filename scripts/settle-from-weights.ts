/**
 * HACKATHON PATH — GenLayer is REQUIRED.
 * No local fallback. No payout without payout_ready + weights from chain.
 *
 *   bun scripts/settle-from-weights.ts INQ-…
 */
import { db, ensureSchema, nowIso } from "../src/lib/db";
import { claims, inquiries, settlements, agents } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  packageObservation,
  packageFinalIntelligence,
  type AgentSubmissionPackage,
} from "../src/lib/genlayer/contribution";
import {
  settlementGate,
  judgeAddress,
  milliToShares,
  recordFinding,
  recordFinal,
} from "../src/lib/genlayer/judge";
import { agentMemoryStats } from "../src/lib/memory";

const inquiryId = process.argv[2];
if (!inquiryId) {
  console.error("usage: bun scripts/settle-from-weights.ts <inquiryId>");
  process.exit(1);
}

await ensureSchema();
const [row] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
if (!row) throw new Error("unknown inquiry");
const rows = await db.select().from(claims).where(eq(claims.inquiryId, inquiryId));
const agentRows = await db.select().from(agents);

const byAgent = new Map<string, AgentSubmissionPackage>();
for (const c of rows) {
  const existing = byAgent.get(c.agentId) ?? { agent_id: c.agentId, observations: [] };
  existing.observations.push(
    packageObservation({ company: c.company, claim: c.claim, evidenceJson: c.evidenceJson }),
  );
  byAgent.set(c.agentId, existing);
}
const packages = Array.from(byAgent.values());

console.log("judge", judgeAddress(), "agents", packages.length);
console.log("1/3 record_finding per agent (retry until ACCEPTED)…");

// Sibyl reliability ledger — past findings that were recalled and held
// earn the agent extra score inside the judge.
const memStats = await agentMemoryStats(packages.map((p) => p.agent_id));
console.log(
  "sibyl:",
  Array.from(memStats.values())
    .map((s) => `${s.agentId.slice(0, 12)} r=${s.verifiedRecalls} d=${s.discoveries}`)
    .join(" · ") || "(cold)",
);

let findingOk = 0;
for (const p of packages) {
  // one aggregated observation per agent
  const sources: string[] = [];
  const events: string[] = [];
  let company: string | null = null;
  for (const o of p.observations.slice(0, 6)) {
    events.push(`${o.company ?? "?"}: ${o.event}`.slice(0, 160));
    if (!company && o.company) company = o.company;
    for (const s of o.sources.slice(0, 2)) sources.push(s);
  }
  const ok = await recordFinding({
    inquiryId,
    agentId: p.agent_id,
    observation: {
      company,
      location: p.observations[0]?.location ?? null,
      contact: p.observations[0]?.contact ?? null,
      event: events.join(" | ").slice(0, 500),
      sources: Array.from(new Set(sources)).slice(0, 5),
      observed: p.observations[0]?.observed ?? new Date().toISOString().slice(0, 10),
      verified_recalls: memStats.get(p.agent_id)?.verifiedRecalls ?? 0,
      discoveries: memStats.get(p.agent_id)?.discoveries ?? 0,
    },
  });
  if (ok) findingOk++;
  console.log(`  ${p.agent_id} ok=${ok}`);
  // Bradbury under load: space writes so consensus can keep up.
  await new Promise((r) => setTimeout(r, 800));
}
if (findingOk === 0) {
  console.error("FATAL: no findings on chain — cannot settle");
  process.exit(1);
}

console.log("2/3 record_final…");
let opportunities: { company: string; location?: string | null; need: string; summary: string }[] = [];
try {
  const readout = row.readoutJson ? JSON.parse(row.readoutJson) : [];
  if (Array.isArray(readout)) {
    opportunities = readout.slice(0, 15).map((r: { company?: string; topClaim?: string }) => ({
      company: String(r.company ?? "unknown"),
      location: null,
      need: String(r.topClaim ?? ""),
      summary: String(r.topClaim ?? ""),
    }));
  }
} catch {}
const finalPkg = packageFinalIntelligence({ question: row.question, opportunities });
// Prefer a compact string the chain accepts reliably; full JSON as fallback.
const finalText =
  opportunities.map((o) => o.company).join(" | ").slice(0, 400) ||
  row.question.slice(0, 200);
let finalOk = await recordFinal({ inquiryId, finalIntelligence: finalText as unknown as Record<string, unknown> });
if (!finalOk) {
  finalOk = await recordFinal({ inquiryId, finalIntelligence: finalPkg });
}
if (!finalOk) {
  console.error("FATAL: record_final failed — GenLayer required for hackathon");
  process.exit(1);
}

console.log("3/3 adjudicate (required)…");
const { milli, ready } = await settlementGate(inquiryId);
if (!milli || !ready) {
  console.error("FATAL: adjudicate/payout_ready failed on GenLayer");
  console.error("  milli", milli, "ready", ready);
  process.exit(1);
}

const shares = milliToShares(milli);
const poolUsd = 20 * 0.6;
const total = Object.values(shares).reduce((a, b) => a + b, 0) || 1;

console.log("\n=== GenLayer settlement (REQUIRED) ===");
console.log("milli", milli);

// Replace any local rows from a prior non-chain settle so the table
// only reflects this chain-backed verdict. Preserve payout_tx if already paid.
const prior = await db
  .select()
  .from(settlements)
  .where(eq(settlements.inquiryId, inquiryId));
const paidByAgent = new Map(
  prior
    .filter((r) => r.payoutTx)
    .map((r) => [r.agentId, { payoutTx: r.payoutTx, paidNative: r.paidNative, tx: r.tx }]),
);
await db.delete(settlements).where(eq(settlements.inquiryId, inquiryId));

for (const [agentId, w] of Object.entries(shares)) {
  const amount = Math.round(poolUsd * (w / total) * 100) / 100;
  const wallet = agentRows.find((a) => a.id === agentId)?.wallet ?? "0x0";
  const already = paidByAgent.get(agentId);
  await db.insert(settlements).values({
    inquiryId,
    agentId,
    wallet,
    weight: w,
    amountUsd: amount,
    createdAt: nowIso(),
    ...(already
      ? {
          payoutTx: already.payoutTx,
          paidNative: already.paidNative ?? amount,
          tx: already.tx ?? already.payoutTx,
        }
      : {}),
  });
  console.log(
    `  ${(w * 100).toFixed(1)}%  $${amount.toFixed(2)}  ${agentId}${already ? " (already paid)" : ""}`,
  );
}
console.log("\nOK — settlement recorded from GenLayer weights only.");

// Inter-comms: ask the IC to web-oracle POST the verdict to the Base
// relayer under consensus. Optional if the hook is not configured yet.
try {
  const { requestPayout } = await import("../src/lib/genlayer/judge");
  console.log("\nGenLayer request_payout (web-oracle → Base relayer)…");
  const out = await requestPayout(inquiryId);
  console.log(out?.slice(0, 400) ?? "(no output)");
} catch (err) {
  console.error("request_payout skipped:", err);
}

// Optional: pay agent wallets in USDC on Base when the Base signer is funded.
try {
  const { usdcReady } = await import("../src/lib/base/usdc");
  if (usdcReady()) {
    console.log("\nPaying agent wallets in USDC on Base…");
    const { spawn } = await import("node:child_process");
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, ["scripts/payout-usdc.ts", inquiryId], {
        stdio: "inherit",
        env: process.env,
        cwd: process.cwd(),
      });
      child.on("exit", (code) => {
        if (code !== 0) console.error("payout-usdc exited", code);
        resolve();
      });
    });
  } else {
    console.log("\nBASE_SIGNER_KEY not set — skip USDC payout (run scripts/payout-usdc.ts later)");
  }
} catch (err) {
  console.error("payout step skipped:", err);
}
