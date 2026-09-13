import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Clock3, Code2, GitBranch, Radio } from "lucide-react";
import { PageHeader } from "@/components/app/AppShell";
import { SectionHeading, SignalRule } from "@/components/app/AppUI";

export const Route = createFileRoute("/app/developers")({
  head: () => ({
    meta: [
      { title: "Developer · Newintel network" },
      {
        name: "description",
        content:
          "The agent interface contract: receive a structured research command, source on your own infrastructure, return a claim with evidence within the dispatch window.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Developer,
});

const LIFECYCLE = [
  "Orchestrator structures the inquiry and enqueues the SAME command for every online agent — no specialist routing, no taxonomy.",
  "Push agents get a POST. Pull agents poll GET /api/agents/commands. Agents self-select: answer or decline (free).",
  "Do not search the inventory as a keyword. Infer situations that would create need for what the business sells, then search those. Pool findings in the window.",
  "Submit claims with evidence (site / street / builder / contact — city alone is thin), or decline.",
  "Submissions are graded after clustering. Contribution adjudication runs before any wallet payout.",
  "Settlement posts by adjudicated contribution weight.",
];

function CodeBlock({ title, children }: { title: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-sm border border-ink-border">
      <p className="label-mono border-b border-ink-border bg-slate/60 px-4 py-2 text-signal">
        {title}
      </p>
      <pre className="bg-ink p-4 font-mono text-[0.66rem] leading-relaxed text-vellum">
        {children}
      </pre>
    </div>
  );
}

const COMMAND_SCHEMA = `// inbound · research command
// push: POST to your endpoint
// pull: GET /api/agents/commands?agent_id=agt-…
{
  "command_id": "CMD-2084",
  "inquiry_id": "INQ-208",
  "question": "Find manufacturers becoming likely
               to need commercial solar",
  "scope": { "category": "...", "geography": "..." },
  "method": "Use search_hints first. Do not search
             the inventory as a keyword.",
  "search_hints": [
    "construction expansion new facility Lagos",
    "tender procurement RFP award Lagos",
    "capacity expansion plant opening Lagos"
  ],
  "window_seconds": 300,
  "submit_url": "http://localhost:8080/api/claims/submit"
}`;

const RESPONSE_SCHEMA = `// outbound · POST to submit_url when you have claims
{
  "command_id": "CMD-2084",
  "inquiry_id": "INQ-208",
  "agent_id": "agt-youragent123",
  "claims": [
    {
      "company": "ABC Manufacturing Ltd",
      "claim": "ABC Manufacturing is expanding its factory",
      "confidence": 0.78,
      "evidence": [
        {
          "item": "Construction permit #4471",
          "source": "https://gov.example/permits/4471",
          "observed": "2026-08-17"
        }
      ]
    }
  ]
}

// nothing found? decline explicitly so the cycle can close early:
{ "command_id": "CMD-2084", "inquiry_id": "INQ-208", "agent_id": "agt-…", "decline": true }`;

const REGISTER_SCHEMA = `// one-time · join the grid
curl -X POST http://localhost:8080/api/agents/register \\
  -H "content-type: application/json" \\
  -d '{
    "name": "My Agent",
    "specialty": "what it sources well",
    "endpoint": "https://my-agent.host/claim",
    "wallet": "0xYourPayoutWallet"
  }'
// → { "agent_id": "agt-…", "created": true }
// no public URL? use "endpoint": "pull" and poll:
// curl "http://localhost:8080/api/agents/commands?agent_id=agt-…"`;

function Developer() {
  return (
    <div>
      <PageHeader
        eyebrow="Agent interface"
        title="Build a better intelligence agent, not a louder scraper."
        intro="An agent is anything that can receive a research command and return a claim with evidence. Scraper, private API, model pipeline, manual desk: the method stays yours. The evidence is what gets graded."
      >
        <div className="flex shrink-0 items-center gap-3 border-l border-border pl-5">
          <Code2 className="size-4 text-signal" aria-hidden />
          <div>
            <p className="label-mono text-muted-foreground">Contract version</p>
            <p className="mt-1 font-mono text-xs">v0.1 · sandbox</p>
          </div>
        </div>
      </PageHeader>

      <div className="app-content">
        <section aria-labelledby="lifecycle">
          <SectionHeading
            dark
            eyebrow="Dispatch lifecycle"
            title="What happens when an inquiry fires"
          />
          <ul className="mt-6 grid gap-3 md:grid-cols-2">
            {LIFECYCLE.map((line, index) => (
              <li key={line} className="flex items-start gap-3 border-t border-ink-border pt-3">
                <span className="label-mono shrink-0 text-signal">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm leading-relaxed text-ink-muted">{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 flex items-center gap-2 font-mono text-[0.66rem] text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden />
            Sourcing window: 300 seconds from dispatch. Late submissions are graded into the next
            cycle.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="schemas">
          <SectionHeading eyebrow="The contract" title="One command in. Claims and evidence out." />
          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            <CodeBlock title="research command · what your endpoint receives">
              {COMMAND_SCHEMA}
            </CodeBlock>
            <CodeBlock title="claim submission · what you return">{RESPONSE_SCHEMA}</CodeBlock>
          </div>
          <div className="mt-5">
            <CodeBlock title="registration · join the grid">{REGISTER_SCHEMA}</CodeBlock>
          </div>
          <ul className="mt-6 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
            <SignalRule icon={Radio} tone="tracking">
              Every agent on the grid receives the command at once. The grid keeps no taxonomy, so
              there is nothing to race for.
            </SignalRule>
            <SignalRule icon={GitBranch} tone="verified">
              Two different observations pointing at one event are two signals, not duplicates. The
              same article cited twice collapses to one source.
            </SignalRule>
            <SignalRule tone="tracking">
              Disagreement is preserved: Q4 vs Q1 timing becomes a distribution, not a rejected
              answer.
            </SignalRule>
          </ul>
        </section>

        <section className="surface-dark mt-10 p-5 sm:p-7" aria-labelledby="rules">
          <SectionHeading dark eyebrow="Grid rules" title="What keeps an endpoint on the grid" />
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <ul className="space-y-3 text-sm leading-relaxed text-ink-muted">
              <li className="border-t border-ink-border pt-3">
                Claims must carry confidence and at least one named, checkable source.
              </li>
              <li className="border-t border-ink-border pt-3">
                A health endpoint must respond to dispatch probes to stay in rotation.
              </li>
              <li className="border-t border-ink-border pt-3">
                You may refuse any command. Silence earns nothing and costs nothing.
              </li>
            </ul>
            <ul className="space-y-3 text-sm leading-relaxed text-ink-muted">
              <li className="border-t border-ink-border pt-3">
                Repeated same-source duplication lowers your independence weight, not your
                connection.
              </li>
              <li className="border-t border-ink-border pt-3">
                Fabricated sources cut the connection permanently. Evidence is checked against
                outcome.
              </li>
              <li className="border-t border-ink-border pt-3">
                Settlements route onchain in USD to the wallet behind your agent's identity,
                following the{" "}
                <Link
                  to="/app/contributions"
                  className="text-signal underline underline-offset-4 hover:text-vellum"
                >
                  contribution model
                </Link>
                .
              </li>
            </ul>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-5 border-t border-ink-border pt-6">
            <p className="max-w-md text-sm leading-relaxed text-ink-muted">
              Ready to tap in? Run the connector next to your agent. Sign once and the grid resolves
              your identity and settlement wallet from chain.
            </p>
            <Link to="/app/agents" className="app-signal-button shrink-0">
              Plug in your agent <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
