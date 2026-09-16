import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import { inquiries, agents, supplyRecords, accounts, claims, dispatchAcks } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { reportSchema, type IntelligenceReport } from "@/lib/orchestrator/report";

/**
 * Sourcing window hint for the UI poll. The orchestrator service on AWS owns
 * the real window (run.ts), this only tells the client how long to expect.
 * Kept local so the web build never pulls the orchestrator into serverless.
 */
const SOURCING_WINDOW_SECONDS = Math.min(
  3600,
  Math.max(60, Number(process.env["PRIME_SOURCING_WINDOW_SECONDS"] ?? 150)),
);

export type { IntelligenceReport };

const submitSchema = z.object({
  question: z.string().min(8).max(500),
  identity: z.string().min(3).max(120).optional(),
  email: z.string().max(160).optional(),
  wallet: z.string().max(60).optional(),
  /** Base Sepolia USDC transfer that paid the run fee. Required when signed in. */
  paymentTx: z.string().max(80).optional(),
});

export type ReadoutEntry = {
  company: string;
  confidence: number;
  claims: number;
  independentSources: number;
  topClaim: string;
  sources: { label: string; url: string }[];
  contact?: string | null;
  facts?: string[];
  inferences?: string[];
  contributingAgents: string[];
};

const readoutSchema = z.array(
  z.object({
    company: z.string(),
    confidence: z.number(),
    claims: z.number(),
    independentSources: z.number(),
    topClaim: z.string(),
    sources: z
      .array(z.object({ label: z.string(), url: z.string() }))
      .optional()
      .default([]),
    contact: z.string().max(280).optional().nullable(),
    facts: z.array(z.string()).optional().default([]),
    inferences: z.array(z.string()).optional().default([]),
    contributingAgents: z.array(z.string()),
  }),
);

export const submitInquiry = createServerFn({ method: "POST" })
  .validator((input: unknown) => submitSchema.parse(input))
  .handler(async ({ data }) => {
    await ensureSchema();
    const id = newId("INQ");
    const ts = nowIso();

    // Signed-in workspaces must pay in USDC on Base Sepolia. Guest runs stay
    // free for evaluation only.
    let billing: { ok: true; kind: "usdc" | "credit"; creditsLeft: number; freeRunsLeft: number; txHash?: string } | { ok: false; error: string } | null =
      null;
    if (data.identity) {
      if (!data.paymentTx || !data.wallet) {
        return {
          error:
            "Connect a wallet and pay the run fee in USDC on Base Sepolia before starting.",
        } as const;
      }
      const { verifyRunPayment } = await import("@/lib/base/run-payment");
      const { RUN_PRICE_USD } = await import("@/lib/billing");
      const paid = await verifyRunPayment({
        txHash: data.paymentTx,
        from: data.wallet,
        minAmountUsd: RUN_PRICE_USD,
      });
      if (!paid.ok) {
        return { error: paid.error } as const;
      }
      const { consumeRunCredit } = await import("@/lib/billing");
      await db.insert(inquiries).values({
        id,
        identity: data.identity ?? null,
        question: data.question,
        status: "dispatching",
        product: "newintel",
        createdAt: ts,
        updatedAt: ts,
      });
      billing = await consumeRunCredit({
        identity: data.identity,
        inquiryId: id,
        email: data.email ?? null,
        wallet: data.wallet ?? null,
        paymentTx: paid.txHash,
      });
      if (!billing.ok) {
        await db.delete(inquiries).where(eq(inquiries.id, id));
        return { error: billing.error } as const;
      }
      const { stampRunEconomics } = await import("@/lib/billing");
      await stampRunEconomics(id, paid.txHash);
    } else {
      await db.insert(inquiries).values({
        id,
        identity: data.identity ?? null,
        question: data.question,
        status: "dispatching",
        product: "newintel",
        createdAt: ts,
        updatedAt: ts,
      });
    }

    // Local/dev: dispatch immediately. (Production can still tick via resume.)
    const submitUrl = (() => {
      if (process.env["PUBLIC_SUBMIT_URL"]) return `${process.env["PUBLIC_SUBMIT_URL"]}/api/claims/submit`;
      if (process.env["VERCEL_URL"]) return `https://${process.env["VERCEL_URL"]}/api/claims/submit`;
      return "http://localhost:8080/api/claims/submit";
    })();
    void import("./run")
      .then(({ runInquiry }) => runInquiry(id, submitUrl))
      .catch((err) => console.error("runInquiry kick failed:", err));
    return {
      inquiryId: id,
      ...(billing && billing.ok
        ? { billing: { kind: billing.kind, creditsLeft: billing.creditsLeft, freeRunsLeft: billing.freeRunsLeft } }
        : {}),
    };
  });

export type SynthesisSource = { label: string; url: string };

export type SynthesisView = {
  preamble: string;
  recommendations: {
    company: string;
    title: string;
    body: string;
    confidence: number;
    verdict: string;
    marketCall: string;
    timeframe: string;
    marketLines?: string[];
    sources: SynthesisSource[];
  }[];
  market?: {
    at: string;
    lines: string[];
    byCompany: Record<string, { symbol: string; price: number; change24hPct: number }>;
    source?: "agent-os" | "mirror";
  } | null;
};

const synthesisSchema = z.object({
  preamble: z.string(),
  recommendations: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      body: z.string(),
      confidence: z.number(),
      verdict: z.string().optional().default("unclear"),
      marketCall: z.string().optional().default(""),
      timeframe: z.string().optional().default(""),
      marketLines: z.array(z.string()).optional().default([]),
      sources: z.array(z.object({ label: z.string(), url: z.string() })),
    }),
  ),
});

const marketSchema = z
  .object({
    at: z.string(),
    lines: z.array(z.string()),
    byCompany: z.record(
      z.string(),
      z.object({ symbol: z.string(), price: z.number(), change24hPct: z.number() }),
    ),
    source: z.enum(["agent-os", "mirror"]).optional().default("mirror"),
  })
  .nullable()
  .optional();

export const getInquiry = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.string().min(3).parse(input))
  .handler(async ({ data: id }) => {
    await ensureSchema();
    let [row] = await db.select().from(inquiries).where(eq(inquiries.id, id));
    if (!row) return null;

    // Advance the cycle when the window closed or everyone answered.
    // Fire-and-forget so the poll response stays fast.
    if (row.status === "collecting" || row.status === "grading") {
      void import("./run")
        .then(({ tryGradeIfReady }) => tryGradeIfReady(id))
        .catch((err) => console.error("tryGradeIfReady kick failed:", err));
    }

    // Live progress for collecting runs: the stored claimsReceived only lands
    // at grading time, which left judges staring at 0 claims for minutes.
    // Count live rows instead so the UI can show evidence arriving.
    let liveClaims: number | null = null;
    let liveAgents: number | null = null;
    let wave: 1 | 2 | null = null;
    if (row.status === "collecting" || row.status === "dispatching") {
      try {
        const raw = typeof row.investigationJson === "string"
          ? JSON.parse(row.investigationJson)
          : row.investigationJson;
        if (raw?.wave === 1) wave = 1;
        else if (raw?.wave === 2) wave = 2;
      } catch {}
      try {
        const [claimRows, ackRows] = await Promise.all([
          db.select({ agentId: claims.agentId }).from(claims).where(eq(claims.inquiryId, id)),
          db.select({ agentId: dispatchAcks.agentId }).from(dispatchAcks).where(eq(dispatchAcks.inquiryId, id)),
        ]);
        liveClaims = claimRows.length;
        liveAgents = new Set([...claimRows.map((r) => r.agentId), ...ackRows.map((a) => a.agentId)]).size;
      } catch {}
    }
    const elapsedSeconds = row.dispatchedAt
      ? Math.max(0, Math.round((Date.now() - Date.parse(row.dispatchedAt)) / 1000))
      : row.createdAt
        ? Math.max(0, Math.round((Date.now() - Date.parse(row.createdAt)) / 1000))
        : null;

    return {
      id: row.id,
      question: row.question,
      category: row.category,
      geography: row.geography,
      status: row.status as "dispatching" | "collecting" | "grading" | "complete" | "failed",
      agentsMatched: row.agentsMatched,
      claimsReceived: row.claimsReceived,
      sourcesClustered: row.sourcesClustered,
      liveClaims,
      liveAgents,
      wave,
      elapsedSeconds,
      readout: (() => {
        if (!row.readoutJson) return null;
        try {
          return readoutSchema.parse(JSON.parse(row.readoutJson));
        } catch (err) {
          console.error("readout parse failed, serving empty:", err);
          return null;
        }
      })(),
      /**
       * The intelligence report. Null on runs from before the report pass, so
       * the UI decides what to show rather than assuming it is there. A
       * malformed report reads as absent instead of failing the whole poll.
       */
      report: (() => {
        if (!row.reportJson) return null;
        try {
          return reportSchema.parse(JSON.parse(row.reportJson));
        } catch (err) {
          // A finished run with a slightly off schema must still show up.
          // The report is the product; dropping it here made complete runs
          // look like "nothing came back".
          try {
            const raw = JSON.parse(row.reportJson) as Record<string, unknown>;
            if (raw && typeof raw === "object" && "executive" in raw) {
              console.error("report schema soft-fail, serving raw:", err);
              return raw as unknown as import("@/lib/orchestrator/report").IntelligenceReport;
            }
          } catch {
            /* fall through */
          }
          console.error("report parse failed, serving without it:", err);
          return null;
        }
      })(),
      reportMode: row.reportMode ?? null,
      synthesis: row.synthesisJson
        ? ({
            ...(synthesisSchema.parse(JSON.parse(row.synthesisJson)) as SynthesisView),
            market: row.marketJson ? marketSchema.parse(JSON.parse(row.marketJson)) : null,
          } as SynthesisView)
        : null,
      error: row.error,
      windowSeconds: SOURCING_WINDOW_SECONDS,
      windowClosesAt: row.windowClosesAt,
      dispatchedAt: row.dispatchedAt,
    };
  });

const runsQuerySchema = z.object({
  identity: z.string().min(3).max(120),
});

// A run older than this is considered abandoned (crashed cycle), never
// resumable. The sourcing window is 5 min; a completed cycle is well under
// 15. Serverless cold-starts can't exceed this either.
const ACTIVE_RUN_WINDOW_MS = 15 * 60 * 1000;

function isActiveStatus(status: string): boolean {
  return status === "dispatching" || status === "collecting" || status === "grading";
}
function isResumable(status: string, createdAt: string | null): boolean {
  return (
    isActiveStatus(status) &&
    !!createdAt &&
    Date.now() - Date.parse(createdAt) < ACTIVE_RUN_WINDOW_MS
  );
}

/**
 * Run history for a signed-in workspace — the durable record. Runs are
 * owned by the account server-side; finished readouts additionally carry
 * their 0G Storage anchor, so nothing depends on any one browser.
 */
export const listMyRuns = createServerFn({ method: "POST" })
  .validator((input: unknown) => runsQuerySchema.parse(input))
  .handler(async ({ data }) => {
    await ensureSchema();
    const rows = await db
      .select()
      .from(inquiries)
      .where(eq(inquiries.identity, data.identity))
      .orderBy(desc(inquiries.createdAt))
      .limit(25);
    return rows.map((row) => ({
      id: row.id,
      question: row.question,
      status: row.status as "dispatching" | "collecting" | "grading" | "complete" | "failed",
      createdAt: row.createdAt,
      claimsReceived: row.claimsReceived ?? 0,
      sourcesClustered: row.sourcesClustered ?? 0,
      complete: row.status === "complete",
      active: isResumable(row.status, row.createdAt),
      error: row.error,
    }));
  });

/** The workspace's most recent in-flight run, if any (resume after refresh / device switch). */
export const latestActiveRun = createServerFn({ method: "POST" })
  .validator((input: unknown) => runsQuerySchema.parse(input))
  .handler(async ({ data }) => {
    await ensureSchema();
    const [row] = await db
      .select()
      .from(inquiries)
      .where(eq(inquiries.identity, data.identity))
      .orderBy(desc(inquiries.createdAt))
      .limit(1);
    if (!row) return null;
    if (!isResumable(row.status, row.createdAt)) return null;
    return { id: row.id };
  });

export const listLiveAgents = createServerFn({ method: "POST" }).handler(async () => {
  await ensureSchema();
  const { isNewintelAgent } = await import("./grid");
  const rows = await db.select().from(agents).orderBy(desc(agents.createdAt));
  return rows
    .filter((a) => isNewintelAgent(a))
    .map((a) => ({
      id: a.id,
      name: a.name,
      specialty: a.specialty,
      wallet: `${a.wallet.slice(0, 6)}…${a.wallet.slice(-4)}`,
      status: a.status,
      reliability: a.reliability,
      // ERC-7857 identity pointer ("0x7857:<tokenId>") once minted.
      agenticId: a.agenticId,
      connectedAt: a.createdAt,
    }));
});

const supplySchema = z.object({
  name: z.string().min(2),
  markets: z.array(z.string()).default([]),
  targets: z.array(z.string()).default([]),
  identity: z.string().min(1).max(160).optional(),
});

export const addSupplyRecord = createServerFn({ method: "POST" })
  .validator((input: unknown) => supplySchema.parse(input))
  .handler(async ({ data }) => {
    await ensureSchema();
    const id = newId("SUP");
    await db.insert(supplyRecords).values({
      id,
      name: data.name,
      identity: data.identity ?? null,
      marketsJson: JSON.stringify(data.markets),
      targetsJson: JSON.stringify(data.targets),
      createdAt: nowIso(),
    });
    return { id };
  });

export const listSupplyRecords = createServerFn({ method: "POST" })
  .validator((input: unknown) => supplySchema.pick({ identity: true }).parse(input ?? {}))
  .handler(async ({ data }) => {
    await ensureSchema();
    if (!data.identity) return [];
    const rows = await db
      .select()
      .from(supplyRecords)
      .where(eq(supplyRecords.identity, data.identity))
      .orderBy(desc(supplyRecords.createdAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      markets: JSON.parse(r.marketsJson) as string[],
      targets: JSON.parse(r.targetsJson) as string[],
    }));
  });

/** Workspace run balance: free trial left + paid credits. */
export const getMyCredits = createServerFn({ method: "POST" })
  .validator((input: unknown) => runsQuerySchema.parse(input))
  .handler(async ({ data }) => {
    const { getAccountFor, FREE_TRIAL_RUNS, RUN_PRICE_USD, poolUsdForRun } = await import(
      "@/lib/billing"
    );
    const account = await getAccountFor(data.identity);
    return {
      credits: account?.credits ?? 0,
      freeRunsLeft: account?.freeRunsLeft ?? FREE_TRIAL_RUNS,
      freeRunsUsed: account?.freeRunsUsed ?? 0,
      runPriceUsd: RUN_PRICE_USD,
      poolUsd: poolUsdForRun(),
    };
  });
