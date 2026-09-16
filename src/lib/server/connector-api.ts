import { z } from "zod";
import { db, ensureSchema, nowIso, newId } from "@/lib/db";
import { agents, claims, commandOutbox, dispatchAcks, inquiries } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { agenticIdConfig, mintAgentIdentity } from "@/lib/base/agentic-id";

/**
 * Connector protocol — the HTTP surface external agents talk to.
 *
 * Two ways to receive work:
 *   push · register a public endpoint; orchestrator POSTs the research command
 *   pull · register endpoint "pull"; poll GET /api/agents/commands?agent_id=
 *
 * One way to return work:
 *   POST /api/claims/submit  { command_id, inquiry_id, agent_id, claims[] }
 *   (or claims: [] / decline: true for an explicit pass)
 *
 *  POST /api/agents/register  { name, specialty, endpoint, wallet, agenticId? }
 *  GET  /api/agents/commands?agent_id=agt-…
 *  POST /api/claims/submit    { command_id, inquiry_id, agent_id, claims[] }
 *  GET  /api/health
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Agents run on their own hosts (AWS, VPS, laptops) — browser-less
      // fetches don't need this, but it costs nothing and keeps the grid
      // open to any agent dashboard that wants to call us from a page.
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
    },
  });

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  specialty: z.string().max(160).optional(),
  /** Public URL for push dispatch, or the literal "pull" for poll-only agents. */
  endpoint: z
    .string()
    .min(1)
    .max(300)
    .refine(
      (v) => v === "pull" || v === "poll" || /^https?:\/\/.+/i.test(v),
      'endpoint must be an http(s) URL or "pull"',
    ),
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "wallet must be an EVM address"),
  agenticId: z.string().max(80).optional(),
  /**
   * Private specialists: method/API stay off public listings; they still
   * hear every command and settle by weight like everyone else.
   */
  private: z.boolean().optional(),
});

const submitSchema = z.object({
  command_id: z.string().min(3),
  inquiry_id: z.string().min(3),
  agent_id: z.string().min(3),
  decline: z.boolean().optional(),
  claims: z
    .array(
      z.object({
        company: z.string().min(1).max(120),
        claim: z.string().min(1).max(500),
        confidence: z.number().min(0).max(1),
        evidence: z
          .array(
            z.object({
              item: z.string().max(300),
              source: z.string().max(300),
              observed: z.string().max(40),
            }),
          )
          .min(1),
      }),
    )
    .max(50)
    .default([]),
});

export async function handleConnectorApi(request: Request): Promise<Response> {
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
  if (url.pathname.startsWith("/api/wallet/")) {
    const { handleWalletApi } = await import("@/lib/server/wallet-api");
    return handleWalletApi(request);
  }
  if (request.method === "POST" && url.pathname === "/api/agents/register") {
    return registerAgent(request);
  }
  if (request.method === "GET" && url.pathname === "/api/agents/commands") {
    return pullCommands(url);
  }
  if (request.method === "POST" && url.pathname === "/api/claims/submit") {
    return submitClaims(request);
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true, service: "newintel-orchestrator" });
  }
  if (request.method === "POST" && url.pathname === "/api/market/assess") {
    return marketAssessRoute(request);
  }
  if (request.method === "POST" && url.pathname === "/api/market/clusters") {
    return marketClustersRoute(request);
  }
  if (request.method === "POST" && url.pathname === "/api/market/changes") {
    return marketChangesRoute(request);
  }
  if (request.method === "POST" && url.pathname === "/api/market/conflicting") {
    return marketConflictingRoute(request);
  }
  if (request.method === "POST" && url.pathname === "/api/market/evidence") {
    return marketEvidenceRoute(request);
  }
  if (request.method === "POST" && url.pathname === "/api/market/investigate") {
    return marketInvestigateRoute(request);
  }
  if (request.method === "POST" && url.pathname === "/api/market/inquiry") {
    return marketInquiryRoute(request);
  }
  return json({ error: "Not found" }, 404);
}

/**
 * Pull-mode inbox. Returns pending research commands for an agent and marks
 * them delivered so they are not re-served. Poll every 15–30s.
 */
async function pullCommands(url: URL): Promise<Response> {
  const agentId = url.searchParams.get("agent_id")?.trim();
  if (!agentId) return json({ error: "agent_id query param required" }, 400);

  await ensureSchema();
  const rows = await db
    .select()
    .from(commandOutbox)
    .where(and(eq(commandOutbox.agentId, agentId), eq(commandOutbox.status, "pending")))
    .orderBy(commandOutbox.id);

  const commands = rows.map((r) => JSON.parse(r.payloadJson) as unknown);
  if (rows.length > 0) {
    const now = nowIso();
    await db
      .update(commandOutbox)
      .set({ status: "delivered", deliveredAt: now })
      .where(
        and(eq(commandOutbox.agentId, agentId), eq(commandOutbox.status, "pending")),
      );
  }
  // Touch last-seen so the agent stays online without a push endpoint.
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (agent) {
    await db.update(agents).set({ lastSeen: nowIso(), status: "online" }).where(eq(agents.id, agentId));
  }

  return json({
    agent_id: agentId,
    count: commands.length,
    commands,
    poll_again_in_seconds: 20,
  });
}

const tickerSchema = z.object({ ticker: z.string().min(1).max(80) });

/** Full thesis for a ticker from the latest completed investigation. */
async function marketAssessRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = tickerSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { agentAssess } = await import("@/lib/orchestrator/agent-read");
  return json(await agentAssess(parsed.data.ticker));
}

/** Cluster results only for a ticker: grouped evidence, no thesis. */
async function marketClustersRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = tickerSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { agentClusters } = await import("@/lib/orchestrator/agent-read");
  return json(await agentClusters(parsed.data.ticker));
}

/** What changed between the last two assessments, plus history. */
async function marketChangesRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = tickerSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { agentThesisChanges, agentHistory } = await import("@/lib/orchestrator/agent-read");
  const [changes, history] = await Promise.all([
    agentThesisChanges(parsed.data.ticker),
    agentHistory(parsed.data.ticker),
  ]);
  return json({ ...changes, history: history.runs });
}

/** What argues against the latest thesis, from stored data only. */
async function marketConflictingRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = tickerSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { agentConflicting } = await import("@/lib/orchestrator/agent-read");
  return json(await agentConflicting(parsed.data.ticker));
}

/** Drill from one thesis thread into its support. */
async function marketEvidenceRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = z
    .object({ ticker: z.string().min(1).max(12), company: z.string().min(1).max(120) })
    .safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { agentEvidence } = await import("@/lib/orchestrator/agent-read");
  return json(await agentEvidence(parsed.data.ticker, parsed.data.company));
}

/** Start a live grid investigation for an outside agent. */
async function marketInvestigateRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = z.object({ question: z.string().min(8).max(500) }).safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { agentInvestigate } = await import("@/lib/orchestrator/agent-read");
  const started = await agentInvestigate(parsed.data.question);
  return json(started, started.ok ? 200 : 429);
}

/** Poll a live investigation by inquiry id. */
async function marketInquiryRoute(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = z.object({ inquiry_id: z.string().min(3) }).safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }
  const { agentInquiryStatus } = await import("@/lib/orchestrator/agent-read");
  // Advance wave/grade when the window closed — same as the app poll.
  void import("@/lib/orchestrator/run")
    .then(({ tryGradeIfReady }) => tryGradeIfReady(parsed.data.inquiry_id))
    .catch(() => {});
  const status = await agentInquiryStatus(parsed.data.inquiry_id);
  if (!status) return json({ error: "Unknown inquiry." }, 404);
  return json(status);
}

async function registerAgent(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }

  await ensureSchema();
  const { name, specialty, endpoint, wallet, agenticId, private: isPrivate } = parsed.data;
  const visibility = isPrivate ? "private" : "public";
  // Tag which product owns this unit. Shared sqld would otherwise mix grids.
  const { isNewintelAgent } = await import("@/lib/orchestrator/grid");
  const grid = isNewintelAgent({ endpoint, name }) ? "newintel" : "stockintel";

  // Re-registering the same endpoint updates rather than duplicates.
  const existing = await db.select().from(agents).where(eq(agents.endpoint, endpoint));
  if (existing.length > 0) {
    const [row] = existing;
    await db
      .update(agents)
      .set({
        name,
        specialty,
        wallet,
        visibility,
        grid,
        ...(agenticId ? { agenticId } : {}),
        status: "online",
        lastSeen: nowIso(),
      })
      .where(eq(agents.id, row!.id));
    return json({ agent_id: row!.id, updated: true, visibility, grid });
  }

  const id = newId("agt");
  await db.insert(agents).values({
    id,
    name,
    specialty: specialty ?? "",
    endpoint,
    wallet,
    visibility,
    grid,
    ...(agenticId ? { agenticId } : {}),
    status: "online",
    createdAt: nowIso(),
    lastSeen: nowIso(),
  });

  // First-time registration → mint an Agentic ID owned by the agent's wallet.
  // Fire-and-forget: identity is an enhancement, never a gate. If the mint
  // fails the agent still participates; a later backfill can retry.
  if (!agenticId && agenticIdConfig().live) {
    void mintAgentIdentity({ agentDbId: id, name, specialty, wallet, endpoint })
      .then(async (minted) => {
        await db
          .update(agents)
          .set({ agenticId: `0x7857:${minted.tokenId}` })
          .where(eq(agents.id, id));
        console.log(
          `agentic-id minted for ${name}: token ${minted.tokenId} → ${minted.explorerUrl}`,
        );
      })
      .catch((err) => console.error(`agentic-id mint deferred for ${name}:`, err.message));
  }

  return json({ agent_id: id, created: true, visibility, grid });
}

async function submitClaims(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Validation failed", issues: parsed.error.issues }, 400);
  }

  await ensureSchema();
  const { command_id, inquiry_id, agent_id, claims: submissions, decline } = parsed.data;
  const claimList = decline ? [] : submissions;

  const [inquiry] = await db.select().from(inquiries).where(eq(inquiries.id, inquiry_id));
  if (!inquiry) {
    return json({ error: "Unknown inquiry." }, 404);
  }
  if (
    inquiry.status !== "collecting" &&
    inquiry.status !== "grading" &&
    inquiry.status !== "dispatching"
  ) {
    return json({ error: `Inquiry is ${inquiry.status}; not collecting claims.` }, 409);
  }

  if (inquiry.windowClosesAt && Date.now() > Date.parse(inquiry.windowClosesAt)) {
    return json({ error: "Sourcing window closed. Submission graded into next cycle." }, 409);
  }

  for (const c of claimList) {
    await db.insert(claims).values({
      inquiryId: inquiry.id,
      agentId: agent_id,
      company: c.company,
      claim: c.claim,
      confidence: c.confidence,
      evidenceJson: JSON.stringify(c.evidence),
      submittedAt: nowIso(),
    });
  }

  // Second copy to the GenLayer contribution judge — same moment as orchestrator.
  if (claimList.length > 0) {
    void (async () => {
      try {
        const { recordFinding } = await import("@/lib/genlayer/judge");
        const { packageObservation } = await import("@/lib/genlayer/contribution");
        for (const c of claimList) {
          await recordFinding({
            inquiryId: inquiry.id,
            agentId: agent_id,
            observation: packageObservation({
              company: c.company,
              claim: c.claim,
              evidenceJson: JSON.stringify(c.evidence),
            }),
          });
        }
      } catch (err) {
        console.error("genlayer.record_finding deferred:", err);
      }
    })();
  }

  // Every response — claims or an explicit decline — is acknowledged, so the
  // orchestrator can early-exit once the whole grid has answered.
  await db.insert(dispatchAcks).values({
    inquiryId: inquiry.id,
    agentId: agent_id,
    declined: claimList.length === 0 ? 1 : 0,
    respondedAt: nowIso(),
  });

  // Clear this command from the pull inbox if it was still pending.
  await db
    .update(commandOutbox)
    .set({ status: "delivered", deliveredAt: nowIso() })
    .where(and(eq(commandOutbox.commandId, command_id), eq(commandOutbox.agentId, agent_id)));

  return json({
    accepted: claimList.length,
    ...(claimList.length === 0
      ? { note: "Decline recorded. Silence is free; declines are polite." }
      : {}),
    inquiry_id: inquiry.id,
    ...(claimList.length > 0
      ? { note: "Graded after clustering. Weight follows proven independence." }
      : {}),
  });
}
