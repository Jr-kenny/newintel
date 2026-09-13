/**
 * Close the GenLayer loop for a finished inquiry (batched):
 *   one record_finding per agent (aggregated observations)
 *   record_final (business package)
 *   adjudicate → weights
 *
 *   bun scripts/genlayer-closeout.ts INQ-…
 */
import { db, ensureSchema } from "../src/lib/db";
import { claims, inquiries } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  recordFinding,
  recordFinal,
  adjudicate,
  payoutReady,
  judgeAddress,
} from "../src/lib/genlayer/judge";
import { packageObservation, packageFinalIntelligence } from "../src/lib/genlayer/contribution";

const inquiryId = process.argv[2];
if (!inquiryId) {
  console.error("usage: bun scripts/genlayer-closeout.ts <inquiryId>");
  process.exit(1);
}

await ensureSchema();
const [row] = await db.select().from(inquiries).where(eq(inquiries.id, inquiryId));
if (!row) {
  console.error("unknown inquiry", inquiryId);
  process.exit(1);
}
console.log("inquiry", row.id, row.status);
const rows = await db.select().from(claims).where(eq(claims.inquiryId, inquiryId));
const byAgent = new Map<string, typeof rows>();
for (const c of rows) {
  const list = byAgent.get(c.agentId) ?? [];
  list.push(c);
  byAgent.set(c.agentId, list);
}
console.log("agents", byAgent.size, "claims", rows.length, "judge", judgeAddress());

// One finding write per agent — aggregated observation (contract appends).
let findingOk = 0;
for (const [agentId, list] of byAgent) {
  const sources: string[] = [];
  const events: string[] = [];
  let company: string | null = null;
  let observed = new Date().toISOString().slice(0, 10);
  for (const c of list.slice(0, 8)) {
    events.push(`${c.company}: ${c.claim}`.slice(0, 200));
    if (!company) company = c.company;
    try {
      const ev = JSON.parse(c.evidenceJson || "[]") as { source?: string; observed?: string }[];
      for (const e of ev.slice(0, 2)) {
        if (e.source) sources.push(e.source);
        if (e.observed) observed = e.observed;
      }
    } catch {}
  }
  const ok = await recordFinding({
    inquiryId,
    agentId,
    observation: {
      company,
      location: null,
      contact: null,
      event: events.join(" | ").slice(0, 800),
      sources: Array.from(new Set(sources)).slice(0, 8),
      observed,
    },
  });
  if (ok) findingOk++;
  console.log(`  record_finding ${agentId} claims=${list.length} ok=${ok}`);
}
console.log(`findings ${findingOk}/${byAgent.size}`);

let opportunities: { company: string; location?: string | null; need: string; summary: string }[] = [];
try {
  const readout = row.readoutJson ? JSON.parse(row.readoutJson) : [];
  if (Array.isArray(readout)) {
    opportunities = readout
      .slice(0, 20)
      .map((r: { company?: string; topClaim?: string }) => ({
        company: String(r.company ?? "unknown"),
        location: null,
        need: String(r.topClaim ?? ""),
        summary: String(r.topClaim ?? ""),
      }));
  }
} catch {}

const finalPkg = packageFinalIntelligence({
  question: row.question,
  opportunities,
});
const finalOk = await recordFinal({ inquiryId, finalIntelligence: finalPkg });
console.log("record_final", finalOk, "opps", opportunities.length);

console.log("adjudicating…");
const weights = await adjudicate(inquiryId);
console.log("weights", JSON.stringify(weights, null, 2));
console.log("payout_ready", await payoutReady(inquiryId));
