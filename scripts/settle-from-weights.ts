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
  adjudicate,
  payoutReady,
  judgeAddress,
  milliToShares,
} from "../src/lib/genlayer/judge";

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

// Import judge writers
const { recordFinding, recordFinal } = await import("../src/lib/genlayer/judge");

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
  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    ok = await recordFinding({
      inquiryId,
      agentId: p.agent_id,
      observation: {
        company,
        location: p.observations[0]?.location ?? null,
        contact: p.observations[0]?.contact ?? null,
        event: events.join(" | ").slice(0, 500),
        sources: Array.from(new Set(sources)).slice(0, 5),
        observed: p.observations[0]?.observed ?? new Date().toISOString().slice(0, 10),
      },
    });
    if (!ok) await new Promise((r) => setTimeout(r, 2000));
  }
  if (ok) findingOk++;
  console.log(`  ${p.agent_id} ok=${ok}`);
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
const milli = await adjudicate(inquiryId);
const ready = await payoutReady(inquiryId);
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
for (const [agentId, w] of Object.entries(shares)) {
  const amount = Math.round(poolUsd * (w / total) * 100) / 100;
  const wallet = agentRows.find((a) => a.id === agentId)?.wallet ?? "0x0";
  await db.insert(settlements).values({
    inquiryId,
    agentId,
    wallet,
    weight: w,
    amountUsd: amount,
    createdAt: nowIso(),
  });
  console.log(`  ${(w * 100).toFixed(1)}%  $${amount.toFixed(2)}  ${agentId}`);
}
console.log("\nOK — settlement recorded from GenLayer weights only.");
