/**
 * Newintel as an MCP server — demand intelligence for outside agents.
 *
 *   Calling agent ── newintel ──> demand read + assessment + evidence
 *
 * No market/exchange leg. Callers pass a demand topic or question; stored
 * reads answer in seconds, live investigation takes minutes.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

function appBase(): string {
  const raw =
    process.env["PUBLIC_APP_URL"]?.trim() ||
    process.env["PUBLIC_SUBMIT_URL"]?.trim() ||
    "https://newintelislive.vercel.app";
  return raw.replace(/\/+$/, "");
}

export function buildNewintelMcpServer(): McpServer {
  const server = new McpServer(
    { name: "newintel", version: "1.0.0" },
    {
      instructions:
        "Newintel is demand intelligence: describe what is supplied and where, and it " +
        "investigates which companies are becoming likely to need it. Stored reads answer " +
        "in seconds; a live investigation takes about 7 minutes. Newintel proposes " +
        "assessments, never a sales guarantee.",
    },
  );

  server.registerTool(
    "newintel_status",
    {
      title: "Newintel status",
      description: "Service identity and HTTP base URL for this deployment.",
      inputSchema: {},
    },
    async () => {
      const payload = {
        service: "newintel",
        http_base_url: appBase(),
        note: "Demand intelligence only — no market/exchange leg.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "newintel_assess",
    {
      title: "Intelligence report",
      description:
        "The full Newintel intelligence report for a demand topic: executive assessment first, then " +
        "evidence with why-it-matters, causal chains, and a bottom line. Served from the latest " +
        "completed investigation. Read-only, no key needed.",
      inputSchema: {
        ticker: z.string().max(80).describe("Demand topic or company keyword, e.g. hotel fit-out Lagos."),
      },
    },
    async ({ ticker }) => {
      const { agentAssess } = await import("@/lib/orchestrator/agent-read");
      const { renderReport } = await import("@/lib/orchestrator/render-report");
      const a = await agentAssess(ticker);
      let text: string;
      if (!a.found) {
        text = `No completed assessment for ${a.ticker} yet. Run a live investigation first.`;
      } else if (a.report) {
        text = renderReport(a.report, a.note ? { note: a.note } : {}) + `\n\nAssessed ${a.assessedAt}.`;
      } else {
        text = [
          ...(a.note ? [a.note] : []),
          "This run predates the intelligence report, so what follows is the older per-exposure thesis.",
          a.preamble,
          ...a.recommendations.map(
            (r) => `${r.company} (${r.verdict}, ${r.confidence}%): ${r.marketCall} [${r.timeframe}]`,
          ),
          `Assessed ${a.assessedAt}.`,
        ]
          .filter(Boolean)
          .join("\n");
      }
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: a,
      };
    },
  );

  server.registerTool(
    "newintel_clusters",
    {
      title: "Evidence clusters",
      description:
        "Grouped evidence for a demand topic: claims, independent source count, top claim, " +
        "sources, and contributing agents. No verdicts. Served from the latest completed " +
        "investigation. Read-only, no key needed.",
      inputSchema: {
        ticker: z.string().max(80).describe("Demand topic, e.g. hotel fit-out Lagos."),
      },
    },
    async ({ ticker }) => {
      const { agentClusters } = await import("@/lib/orchestrator/agent-read");
      const c = await agentClusters(ticker);
      const text = c.found
        ? c.clusters
            .map(
              (e) =>
                `${e.company} [${e.confidence}%]: ${e.topClaim} (${e.independentSources} independent sources)`,
            )
            .join("\n")
        : `No completed clusters for ${c.ticker} yet. Run a live investigation first.`;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: c,
      };
    },
  );

  server.registerTool(
    "newintel_thesis_changes",
    {
      title: "Thesis changes",
      description:
        "What changed between the last two assessments for a demand topic: verdict flips, confidence " +
        "moves, added and removed threads, a strengthening or weakening direction, plus the full " +
        "assessment history. Served from stored runs. Read-only, no key needed.",
      inputSchema: {
        ticker: z.string().max(80).describe("Demand topic to compare, e.g. cement for hotels."),
      },
    },
    async ({ ticker }) => {
      const { agentThesisChanges, agentHistory } = await import("@/lib/orchestrator/agent-read");
      const [changes, history] = await Promise.all([agentThesisChanges(ticker), agentHistory(ticker)]);
      const payload = { ...changes, history: history.runs };
      const text = !changes.found
        ? changes.note
        : !changes.changed
          ? `No material change since ${changes.previousAt}. Direction: ${changes.direction}.`
          : [
              `Direction: ${changes.direction} (${changes.previousAt} -> ${changes.currentAt}).`,
              ...changes.flips.map((f) => `${f.company}: ${f.from} -> ${f.to} (${f.confidenceFrom}% -> ${f.confidenceTo}%).`),
              ...changes.confidenceMoves.map((m) => `${m.company}: confidence ${m.from}% -> ${m.to}%.`),
              ...changes.added.map((a) => `New thread: ${a}.`),
              ...changes.removed.map((r) => `Dropped thread: ${r}.`),
            ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "newintel_conflicting",
    {
      title: "Conflicting evidence",
      description:
        "What argues against acting on the latest assessment for a demand topic: closed windows, " +
        "the weakest clusters, and the grading contradiction count. Stored data only, never invented. " +
        "Read-only, no key needed.",
      inputSchema: {
        ticker: z.string().max(80).describe("Demand topic to challenge, e.g. cold-chain Nigeria."),
      },
    },
    async ({ ticker }) => {
      const { agentConflicting } = await import("@/lib/orchestrator/agent-read");
      const c = await agentConflicting(ticker);
      const text = !c.found
        ? c.note
        : [
            `Contradictions in grading: ${c.contradictions}.`,
            ...c.against.map((a) => `${a.company} reads ${a.verdict} (${a.confidence}%): ${a.marketCall}`),
            ...c.weakestClusters.map(
              (w) => `Thin ice: ${w.company} stands on ${w.independentSources} independent sources.`,
            ),
            c.note,
          ]
            .filter(Boolean)
            .join("\n");
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: c,
      };
    },
  );

  server.registerTool(
    "newintel_evidence",
    {
      title: "Evidence drill-down",
      description:
        "Drill from one assessment thread into its support: verdict, sources, the matching evidence " +
        "cluster, and the top underlying claims with evidence. Read-only, no key needed.",
      inputSchema: {
        ticker: z.string().max(80).describe("Demand topic, e.g. hotel fit-out Lagos."),
        company: z.string().max(120).describe("Company thread to drill into, e.g. Marlowe Bay Hotels."),
      },
    },
    async ({ ticker, company }) => {
      const { agentEvidence } = await import("@/lib/orchestrator/agent-read");
      const e = await agentEvidence(ticker, company);
      const text = !e.found
        ? e.note
        : [
            `${e.company} reads ${e.verdict}: ${e.marketCall}`,
            ...(e.cluster ? [`Cluster: ${e.cluster.topClaim} (${e.cluster.independentSources} independent sources).`] : []),
            ...e.claims.map((c) => `- ${c.claim} [${c.confidence}]`),
          ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: e,
      };
    },
  );

  server.registerTool(
    "newintel_investigate",
    {
      title: "Live investigation",
      description:
        "Run the full Newintel grid on a question: ten specialists investigate in parallel, " +
        "evidence clusters, and a thesis synthesizes with priced-or-not verdicts. A full run takes " +
        "about 7 minutes. Returns an inquiry id immediately; poll newintel_inquiry every 30 seconds " +
        "until status is complete, and never present stored reads as this run's result while it is " +
        "still open. At most two outside runs at once; beyond that the grid answers busy. Read-only " +
        "market data, no key needed.",
      inputSchema: {
        question: z
          .string()
          .min(8)
          .max(500)
          .describe("Plain-language demand question, e.g. Which hotel chains are expanding in Lagos?"),
      },
    },
    async ({ question }) => {
      const { agentInvestigate } = await import("@/lib/orchestrator/agent-read");
      const started = await agentInvestigate(question);
      const payload = started;
      const text = started.ok
        ? `Investigation ${started.inquiryId} dispatched. Poll newintel_inquiry every 30 seconds until status is complete; a full run takes about 7 minutes, do not summarize before then.`
        : `Grid busy: ${started.error}`;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "newintel_inquiry",
    {
      title: "Investigation status",
      description:
        "Poll a live investigation by inquiry id: status, progress counts, wait discipline, and the " +
        "full thesis once complete. Read-only poll, the run advances on its own. Keep polling every " +
        "30 seconds until status is complete, about 7 minutes total.",
      inputSchema: {
        inquiry_id: z.string().min(3).describe("Inquiry id from newintel_investigate."),
      },
    },
    async ({ inquiry_id }) => {
      const { agentInquiryStatus } = await import("@/lib/orchestrator/agent-read");
      const s = await agentInquiryStatus(inquiry_id);
      if (!s) {
        const payload = { found: false, inquiryId: inquiry_id };
        return {
          content: [{ type: "text" as const, text: `Unknown inquiry ${inquiry_id}.` }],
          structuredContent: payload,
        };
      }
      const text =
        s.status === "complete" && s.result
          ? s.result.report
            ? [
                s.result.report.executive.whatHappened,
                s.result.report.executive.assessment,
                `Window: ${s.result.report.implication.pricedIn} (${s.result.report.implication.pricedInReason})`,
                `Watch next: ${s.result.report.bottomLine.monitor}`,
              ]
                .filter(Boolean)
                .join("\n")
            : [
                s.result.preamble,
                ...s.result.recommendations.map(
                  (r) => `${r.company} (${r.verdict}, ${r.confidence}%): ${r.marketCall} [${r.timeframe}]`,
                ),
              ]
                .filter(Boolean)
                .join("\n")
          : s.status === "failed"
            ? `Investigation failed: ${s.error ?? "unknown error"}.`
            : `${s.status}: ${s.progress.claimsReceived} claims from ${s.progress.agentsMatched} agents, ${s.timing.elapsedSeconds}s elapsed of about 7 minutes. ${s.timing.note ?? "Poll again in 30 seconds."}`;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: s,
      };
    },
  );

  return server;
}

/**
 * Handle one Streamable HTTP request. Stateless: a fresh server and
 * transport per request, which is what a serverless deployment behind a
 * load balancer can actually honour.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = buildNewintelMcpServer();
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
