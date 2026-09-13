/**
 * Sample Newintel connector — reference implementation for agent developers.
 *
 * PUSH (default — needs a URL the orchestrator can reach):
 *   bun run examples/sample-connector.ts "hospitality Lagos"
 *
 * PULL (no public URL — laptop / Claude Code / local script):
 *   CONNECTOR_MODE=pull bun run examples/sample-connector.ts "hospitality Lagos"
 *
 * What it does:
 *   1. Registers your agent (wallet = settlement address).
 *   2. Receives research commands (push listen or pull poll).
 *   3. Runs your research function (this sample emits one claim).
 *   4. Submits claims + evidence, or declines, within the window.
 */

const ORCHESTRATOR = process.env["PRIME_ORCHESTRATOR"] ?? "http://localhost:8080";
const PORT = Number(process.env["CONNECTOR_PORT"] ?? 8787);
const MODE = (process.env["CONNECTOR_MODE"] ?? "push").toLowerCase() === "pull" ? "pull" : "push";

const name = process.env["CONNECTOR_NAME"] ?? "Sample Demand Desk";
const specialty = process.argv[2] ?? "hospitality construction west africa";
const wallet = process.env["CONNECTOR_WALLET"] ?? "0x0000000000000000000000000000000000000001";

type ResearchCommand = {
  command_id: string;
  inquiry_id: string;
  question: string;
  scope: { category?: string; geography?: string };
  /** Infer demand-creating situations; do not search the product keyword. */
  method?: string;
  /** Orchestrator lookups — run these first. */
  search_hints?: string[];
  window_seconds: number;
  submit_url: string;
  memory_brief?: string;
};

let agentIdCache: { agent_id: string } | null = null;

async function register(): Promise<{ agent_id: string }> {
  if (agentIdCache) return agentIdCache;
  const endpoint = MODE === "pull" ? "pull" : `http://localhost:${PORT}/claim`;
  const res = await fetch(`${ORCHESTRATOR}/api/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, specialty, endpoint, wallet }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Registration failed: ${JSON.stringify(body)}`);
  agentIdCache = body as { agent_id: string };
  return agentIdCache;
}

async function main() {
  const registered = await register();
  console.log(`✓ registered (${MODE}):`, registered);
  console.log(`  orchestrator: ${ORCHESTRATOR}`);

  if (MODE === "pull") {
    console.log("✓ polling /api/agents/commands every 15s — Ctrl-C to stop");
    for (;;) {
      try {
        const res = await fetch(
          `${ORCHESTRATOR}/api/agents/commands?agent_id=${encodeURIComponent(registered.agent_id)}`,
        );
        const body = (await res.json()) as { commands?: ResearchCommand[]; count?: number };
        for (const cmd of body.commands ?? []) {
          console.log("→ pulled command:", cmd.command_id, "—", cmd.question.slice(0, 80));
          void researchAndSubmit(cmd);
        }
      } catch (err) {
        console.error("poll failed:", err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }

  Bun.serve({
    port: PORT,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/claim") {
        const command = (await request.json()) as ResearchCommand;
        console.log("→ push command received:", command.command_id);
        void researchAndSubmit(command);
        return Response.json({ accepted: true });
      }
      return new Response("newintel sample connector", { status: 200 });
    },
  });
  console.log(`✓ listening on http://localhost:${PORT}/claim`);
}

/**
 * REPLACE THIS with your real intelligence pipeline.
 *
 * Method (from the command, domain-agnostic):
 *   Do not search "who buys X". Infer situations that would create need for
 *   what the business sells, then search those situations. Pool findings in
 *   the window. Decline if it is not your market — free.
 *
 * This sample only demonstrates the wire protocol with a toy self-select.
 * Your agent decides its own market — we do not hardcode niches for you.
 */
async function researchAndSubmit(command: ResearchCommand) {
  // Wire-protocol demo: always decline so this sample never pollutes a grid.
  // Replace with YOUR pipeline:
  //   1. Run command.search_hints first (orchestrator: "look up this / that")
  //   2. Do NOT search the inventory as a product keyword
  //   3. Pool detailed observations in the window, or decline
  await fetch(command.submit_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command_id: command.command_id,
      inquiry_id: command.inquiry_id,
      agent_id: (await register()).agent_id,
      decline: true,
      claims: [],
    }),
  });
  console.log(
    "✗ sample declined (wire demo). hints:",
    command.search_hints?.slice(0, 3).join(" | ") ?? "(none)",
  );
}

await main();
