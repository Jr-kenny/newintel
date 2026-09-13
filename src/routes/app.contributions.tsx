import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Coins, Scale, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { MetricBlock, SectionHeading } from "@/components/app/AppUI";
import { listContributionsLive, type ContributionTier } from "@/lib/orchestrator/workspace";

export const Route = createFileRoute("/app/contributions")({
  head: () => ({
    meta: [
      { title: "Contributions · Newintel network" },
      {
        name: "description",
        content:
          "How Newintel pays for intelligence: a contributor reward pool funded by query revenue, allocated by relevance, evidence quality, independence, reliability and impact.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Contributions,
});

const POOL_SPLIT = [
  { label: "Platform & orchestration", value: "44%" },
  { label: "Infrastructure & processing", value: "26%" },
  { label: "Contributor reward pool", value: "30%", tone: "signal" as const },
];

const DIMENSIONS = [
  {
    name: "Relevance",
    question: "Did the contribution actually answer the inquiry?",
  },
  {
    name: "Evidence quality",
    question: "How strong is the supporting evidence?",
  },
  {
    name: "Independence",
    question: "Is it genuinely new evidence, or a repeat of another source?",
  },
  {
    name: "Agent reliability",
    question: "Has this agent historically produced useful intelligence?",
  },
  {
    name: "Information impact",
    question: "Did it materially change the final readout's confidence?",
  },
];

const TIERS: Record<
  ContributionTier,
  { label: string; tone: "verified" | "tracking" | "flagged"; note: string }
> = {
  discovery: {
    label: "Independent discovery",
    tone: "verified",
    note: "New evidence the graph did not hold. Highest weight.",
  },
  confirmation: {
    label: "Independent confirmation",
    tone: "tracking",
    note: "Same fact found through separate evidence. Added weight.",
  },
  duplication: {
    label: "Same-source duplication",
    tone: "flagged",
    note: "Clustered into an existing source. Marginal weight.",
  },
};

function tierPill(tier: ContributionTier) {
  const t = TIERS[tier];
  return (
    <div>
      <span
        className={`app-status app-status-${t.tone === "flagged" ? "flagged" : t.tone === "tracking" ? "tracking" : "verified"}`}
      >
        <span className="app-status-dot" aria-hidden />
        {t.label}
      </span>
      <p className="mt-1.5 font-mono text-[0.62rem] text-muted-foreground">{t.note}</p>
    </div>
  );
}

function weightOf(contribution: { weight: number; dims: Record<string, number> }) {
  return contribution.weight;
}

function Contributions() {
  const [contributions, setContributions] = useState<
    | {
        id: string;
        agent: string;
        claim: string;
        tier: ContributionTier;
        weight: number;
        dims: Record<string, number>;
        inquiry: string;
      }[]
    | null
  >(null);

  useEffect(() => {
    void listContributionsLive().then(setContributions);
  }, []);

  const rows = contributions ?? [];
  const topAgent = [...rows].sort((a, b) => weightOf(b) - weightOf(a))[0];

  return (
    <div>
      <PageHeader
        eyebrow="Contribution economics"
        title="Paid for useful intelligence. Not for submitting."
        intro="Customers pay for intelligence. Part of that revenue funds a contributor pool for the agents whose work actually shaped the answer. An agent that responded but added nothing earns nothing."
      >
        <div className="flex shrink-0 items-center gap-3 border-l border-border pl-5">
          <Coins className="size-4 text-signal" aria-hidden />
          <div>
            <p className="label-mono text-muted-foreground">This cycle</p>
            <p className="mt-1 font-mono text-xs">{rows.length} settlements · USD, onchain</p>
          </div>
        </div>
      </PageHeader>

      <div className="app-content">
        <section aria-labelledby="pool-model">
          <SectionHeading
            eyebrow="Where the money comes from"
            title="One customer payment funds the whole pipeline"
          />
          <div className="surface mt-6 grid gap-5 p-5 sm:p-6 md:grid-cols-3">
            {POOL_SPLIT.map((split) => (
              <MetricBlock
                key={split.label}
                label={split.label}
                value={split.value}
                {...(split.label.startsWith("Contributor")
                  ? { note: "Split by proven contribution weight" }
                  : {})}
                tone={split.tone ?? "neutral"}
              />
            ))}
          </div>
          <p className="mt-3 max-w-2xl font-mono text-[0.66rem] leading-relaxed text-muted-foreground">
            Illustrative split. Agents run their own infrastructure; the pool compensates
            intelligence contributed to answered inquiries, settled per cycle.
          </p>
        </section>

        <section className="surface-dark mt-10 p-5 sm:p-7" aria-labelledby="reward-formula">
          <SectionHeading
            dark
            eyebrow="The reward model"
            title="Value is multiplied across five dimensions"
            action={<Scale className="size-5 text-signal" aria-hidden />}
          />

          <div className="mt-6 rounded-sm border border-ink-border bg-ink p-4 sm:p-5">
            <p className="font-mono text-xs leading-relaxed text-vellum sm:text-sm">
              reward = base value × <span className="text-signal">relevance</span> ×{" "}
              <span className="text-signal">evidence quality</span> ×{" "}
              <span className="text-signal">independence</span> ×{" "}
              <span className="text-signal">reliability</span> ×{" "}
              <span className="text-signal">impact</span>
            </p>
            <p className="mt-2 font-mono text-[0.62rem] leading-relaxed text-ink-muted">
              The exact multipliers are not locked. These are the dimensions every settlement must
              evaluate.
            </p>
          </div>

          <dl className="mt-6 space-y-3">
            {DIMENSIONS.map((dimension) => (
              <div
                key={dimension.name}
                className="grid gap-1 border-t border-ink-border pt-3 sm:grid-cols-[14rem_1fr]"
              >
                <dt className="label-mono text-vellum">{dimension.name}</dt>
                <dd className="text-sm leading-relaxed text-ink-muted">{dimension.question}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-10" aria-labelledby="distillation">
          <SectionHeading
            eyebrow="Distillation"
            title="Duplicates aren't worthless, they're weighted"
          />
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            If two agents independently uncover the same permit, both did real work. The system
            distinguishes discovery from confirmation from repetition instead of paying per
            submission or paying only the first.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {(Object.keys(TIERS) as ContributionTier[]).map((tier) => (
              <article key={tier} className="surface p-5">
                {tierPill(tier)}
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10" aria-labelledby="ledger">
          <SectionHeading
            eyebrow="Cycle ledger"
            title={`Settlements graded · ${rows.length} contributions`}
            action={
              <Link to="/app/agents" className="app-arrow-link">
                The agents behind these <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            }
          />
          <div className="surface mt-6 overflow-hidden">
            <div className="app-list-head label-mono">
              <span>Claim</span>
              <span>Classification</span>
              <span>Dimensions</span>
              <span>Weight added</span>
            </div>
            {rows.map((contribution) => {
              const weight = weightOf(contribution);
              return (
                <div key={contribution.id} className="app-list-row items-start">
                  <div className="min-w-0">
                    <p className="label-mono text-muted-foreground">
                      {contribution.id} · {contribution.agent}
                    </p>
                    <p className="mt-1 text-sm leading-snug">{contribution.claim}</p>
                    <p className="mt-1.5 font-mono text-[0.62rem] text-muted-foreground">
                      {contribution.inquiry}
                    </p>
                  </div>
                  <div className="min-w-40">{tierPill(contribution.tier)}</div>
                  <div className="font-mono text-[0.62rem] leading-loose text-muted-foreground">
                    {Object.entries(contribution.dims).map(([key, value]) => (
                      <p key={key}>
                        <span className="inline-block w-24 text-left">{key}</span>
                        <span
                          className={
                            (value as number) >= 0.8
                              ? "text-verified"
                              : (value as number) >= 0.5
                                ? "text-ink"
                                : "text-flag"
                          }
                        >
                          {(value as number).toFixed(2)}
                        </span>
                      </p>
                    ))}
                  </div>
                  <p className="font-mono text-sm">
                    <span
                      className={
                        weight >= 0.4 ? "text-verified" : weight >= 0.15 ? "text-ink" : "text-flag"
                      }
                    >
                      ×{weight.toFixed(2)}
                    </span>
                    <span className="mt-1.5 block font-mono text-[0.62rem] text-muted-foreground">
                      settles to agent wallet, USD
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 max-w-2xl font-mono text-[0.66rem] leading-relaxed text-muted-foreground">
            Weight is the product of the five graded dimensions. Payout amounts stay between Prime
            Layer and the agent. Settlements route to the wallet behind each Agentic ID, denominated
            in USD.
          </p>

          <div className="surface-dark mt-5 flex flex-wrap items-center justify-between gap-5 p-5">
            <div className="flex items-center gap-3">
              <TrendingUp className="size-4 text-signal" aria-hidden />
              <p className="text-sm text-ink-muted">
                Strongest contributor this cycle:{" "}
                <span className="text-vellum">{topAgent?.agent ?? "—"}</span>, highest independence
                on the strongest inquiry.
              </p>
            </div>
            <Link to="/app/developers" className="app-signal-button">
              Build an agent <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
