import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Bot, Database, Layers3, ScanLine } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeading, StatusPill } from "@/components/app/AppUI";
import { RequireAuth } from "@/components/app/auth-gate";
import { ReportView } from "@/components/app/ReportView";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";
import {
  getInquiry,
  listSupplyRecords,
  submitInquiry,
  listMyRuns,
  latestActiveRun,
} from "@/lib/orchestrator/fns";
export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Intelligence · Newintel" },
      {
        name: "description",
        content:
          "Ask a demand question in plain language. Newintel investigates the companies behind it, clusters evidence and states the verdict and the window.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Intelligence,
});

type InquiryState = NonNullable<Awaited<ReturnType<typeof getInquiry>>>;

type ReadoutEntry = {
  company: string;
  confidence: number;
  claims: number;
  independentSources: number;
  topClaim: string;
  sources: { label: string; url: string }[];
  contributingAgents: string[];
};

/**
 * Deliberately spread across sectors and regions. All three used to be
 * semiconductors, which quietly told users the product only works on chips.
 * Nothing in the pipeline is sector-specific and the examples should say so.
 */
const EXAMPLES = [
  "Which hotel chains and manufacturers are expanding or building new facilities right now?",
  "We took in $13M of mixed industrial stock with 6 months to move it — find partners worldwide whose projects or expansions will need it soon.",
  "We supply packaging materials and cold-chain equipment — which food processors and pharma distributors are expanding capacity this quarter?",
];

type RunHistoryRow = {
  id: string;
  question: string;
  status: "dispatching" | "collecting" | "grading" | "complete" | "failed";
  createdAt: string | null;
  claimsReceived: number;
  sourcesClustered: number;
  complete: boolean;
  active: boolean;
  error?: string | null;
};

const FACTS = [
  "World trade in intermediate goods is ~50% of total trade — demand forms in the middle of the chain, not at the shelf.",
  "A 250-room hotel at fit-out needs ~1,200 lighting points and 300+ electrical panels before a guest arrives.",
  "Cold-chain breaks cause ~13% of global food loss — every new pharma/food plant expansion is a packaging opportunity.",
  "Factory construction to first production averages 18 months — procurement happens at month 12-15, not day one.",
  "One permit plus one contractor statement beats five outlets citing the same press release.",
  "Five citations of one article count as one source. Independence is what earns confidence.",
  "A regulator speaking for itself outranks any story about it, whether that is the SEC or a tender board in Lagos.",
  "Search finds pages. Lead databases find contacts. Neither names the event that created the need.",
  "An interesting signal with a closed window is a good outcome, not a failure.",
  "Every claim carries its evidence, and the readout states what would prove it wrong.",
  "A recommendation must answer: why THIS company, why NOW, and how it connects to what the buyer sells.",
  "The chain forms first. The opportunity ranking comes second. Never the reverse.",
];

function RotatingFacts() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((v) => (v + 1) % FACTS.length), 3200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="mt-2 min-h-[2.5rem] text-sm leading-relaxed text-ink">
      <span className="font-mono text-xs text-signal">#{String(i + 1).padStart(2, "0")}</span> · {FACTS[i]}
    </p>
  );
}

/** Live sourcing countdown in seconds, then an honest grading state. */
function SourcingCountdown({
  deadlineIso,
  windowSeconds,
  grading,
  claims,
  sources,
}: {
  deadlineIso: string | null;
  windowSeconds: number;
  grading: boolean;
  claims: number;
  sources: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadlineIso || grading) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [deadlineIso, grading]);
  const remaining = deadlineIso
    ? Math.max(0, Math.ceil((Date.parse(deadlineIso) - now) / 1000))
    : null;
  const pct =
    remaining === null
      ? 100
      : Math.min(100, Math.max(0, ((windowSeconds - remaining) / windowSeconds) * 100));

  return (
    <div className="surface p-5 sm:p-6" aria-live="polite">
      <p className="label-mono text-signal">
        {grading || remaining === 0 ? "Grading the evidence" : "Sourcing across every surface"}
      </p>
      {grading || remaining === 0 ? (
        <>
          <p className="mt-2 font-mono text-lg text-ink">grading…</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {claims === 0
              ? "The window just closed and the first claims are still landing. Grading starts the moment they do."
              : `The window is closed. ${claims} claims from ${sources} source clusters are being graded and synthesized into your readout.`}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 font-mono text-5xl tabular-nums text-ink">
            {remaining}
            <span className="text-2xl text-muted-foreground">s</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            until the sourcing window closes. Then clustering, grading, your readout.
          </p>
        </>
      )}
      <div className="app-progress mt-4" aria-hidden>
        <span style={{ width: `${grading || remaining === 0 ? 100 : pct}%` }} />
      </div>
    </div>
  );
}

function Intelligence() {
  const [query, setQuery] = useState(
    "Which hotel chains and manufacturers are expanding or building new facilities right now?",
  );
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [inquiry, setInquiry] = useState<InquiryState | null>(null);
  const [supply, setSupply] = useState<Awaited<ReturnType<typeof listSupplyRecords>>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<RunHistoryRow[]>([]);
  const pollRef = useRef<number | null>(null);
  const [privy, setPrivy] = useState<PrivyIdentityInfo>({
    authenticated: false,
    email: null,
    walletAddress: null,
    firstWallet: null,
  });
  const identity = privy.email ?? privy.walletAddress ?? null;

  useEffect(() => {
    void listSupplyRecords().then(setSupply);
  }, []);

  useEffect(
    () => () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    },
    [],
  );

  const poll = useCallback((inquiryId: string) => {
    try { sessionStorage.removeItem("prime-layer:dismissed"); } catch {}
    if (pollRef.current) window.clearInterval(pollRef.current);
    let ticks = 0;
    pollRef.current = window.setInterval(async () => {
      ticks += 1;
      const state = await getInquiry({ data: inquiryId });
      if (!state) return;
      setInquiry(state);
      if (state.status === "failed") {
        window.clearInterval(pollRef.current!);
        setPhase("failed");
      }
      // The report is the product: prefer runs carrying one, and accept the
      // raw readout otherwise. Legacy synthesis counts as a finished run too.
      if (
        state.status === "complete" &&
        (state.report || state.synthesis || (state.readout && state.readout.length > 0))
      ) {
        window.clearInterval(pollRef.current!);
        setPhase("done");
        if (identityRef.current) void refreshRunsRef.current?.();
      } else if (state.status === "complete" && state.readout) {
        setPhase("done");
        if (identityRef.current) void refreshRunsRef.current?.();
      }
      // A healthy cycle finishes in ~6 min. Past 12, the run is dead. Stop
      // watching instead of spinning forever.
      if (ticks > 360) {
        window.clearInterval(pollRef.current!);
        setPhase("failed");
        if (identityRef.current) void refreshRunsRef.current?.();
      }
    }, 2000);
  }, []);

  // Refs so poll can notify the history refresh without a circular dependency.
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);
  const refreshRunsRef = useRef<(() => void) | null>(null);

  // Resume + history: runs belong to the account on the server. On sign-in,
  // adopt any in-flight run (refresh / dead phone / new device) and load the
  // workspace's run history. No browser storage involved.
  // If user hit New request and navigated away without running, don't snap back to last readout.
  const refreshRuns = useCallback(() => {
    if (!identity) return;
    void latestActiveRun({ data: { identity } }).then((activeRun) => {
      if (!activeRun || pollRef.current) return; // already watching something
      setPhase("running");
      poll(activeRun.id);
    });
    void listMyRuns({ data: { identity } }).then((rows) => {
      if (!rows.length) return;
      setHistory(rows);
      // If nothing is in flight, show the most recent finished readout so the
      // workspace always opens with the last result they paid for, unless the user dismissed it.
      if (phase === "idle") {
        try {
          if (sessionStorage.getItem("prime-layer:dismissed") === "1") return;
        } catch {}
        const last = rows.find((r) => r.complete);
        if (last) {
          void getInquiry({ data: last.id }).then((state) => {
            if (state?.readout?.length || state?.synthesis) {
              setInquiry(state);
              setPhase("done");
            }
          });
        }
      }
    });
  }, [identity, phase, poll]);

  useEffect(() => {
    refreshRunsRef.current = refreshRuns;
  }, [refreshRuns]);
  useEffect(() => {
    refreshRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  // Deep-link from Supply's Recent enquiries: /app?inquiry=INQ_xxx
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("inquiry");
    if (q && identity) {
      void getInquiry({ data: q }).then((state) => {
        if (state?.readout?.length || state?.synthesis) {
          setInquiry(state);
          setPhase("done");
          window.history.replaceState({}, "", "/app");
        }
      });
    }
  }, [identity]);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || phase === "running") return;
    const submittedQuery = query;
    setSubmitting(true);

    let paymentTx: string | undefined;
    if (identity && privy.walletAddress && privy.firstWallet) {
      const { payRunFeeUsdc } = await import("@/components/app/pay-run");
      const { RUN_PRICE_USD } = await import("@/lib/billing");
      const paid = await payRunFeeUsdc({
        wallet: privy.firstWallet,
        amountUsd: RUN_PRICE_USD,
      });
      if (!paid.ok) {
        setSubmitting(false);
        setPhase("failed");
        setInquiry({
          id: "billing",
          question: submittedQuery,
          category: null,
          geography: null,
          status: "failed",
          agentsMatched: 0,
          claimsReceived: 0,
          sourcesClustered: 0,
          liveClaims: null,
          liveAgents: null,
          wave: null,
          elapsedSeconds: null,
          readout: null,
          report: null,
          reportMode: null,
          synthesis: null,
          error: paid.error,
          windowSeconds: 150,
          windowClosesAt: null,
          dispatchedAt: null,
        } as InquiryState);
        return;
      }
      paymentTx = paid.txHash;
    } else if (identity) {
      setSubmitting(false);
      setPhase("failed");
      setInquiry({
        id: "billing",
        question: submittedQuery,
        category: null,
        geography: null,
        status: "failed",
        agentsMatched: 0,
        claimsReceived: 0,
        sourcesClustered: 0,
        liveClaims: null,
        liveAgents: null,
        wave: null,
        elapsedSeconds: null,
        readout: null,
        report: null,
        reportMode: null,
        synthesis: null,
        error: "Connect a wallet to pay the run fee in USDC on Base Sepolia.",
        windowSeconds: 150,
        windowClosesAt: null,
        dispatchedAt: null,
      } as InquiryState);
      return;
    }

    const result = await submitInquiry({
      data: {
        question: submittedQuery,
        ...(identity
          ? {
              identity,
              ...(privy.email ? { email: privy.email } : {}),
              ...(privy.walletAddress ? { wallet: privy.walletAddress } : {}),
              ...(paymentTx ? { paymentTx } : {}),
            }
          : {}),
      },
    });
    setSubmitting(false);
    if ("error" in result && result.error) {
      setPhase("failed");
      setInquiry({
        id: "billing",
        question: submittedQuery,
        category: null,
        geography: null,
        status: "failed",
        agentsMatched: 0,
        claimsReceived: 0,
        sourcesClustered: 0,
        liveClaims: null,
        liveAgents: null,
        wave: null,
        elapsedSeconds: null,
        readout: null,
        report: null,
        reportMode: null,
        synthesis: null,
        error: result.error,
        windowSeconds: 150,
        windowClosesAt: null,
        dispatchedAt: null,
      } as InquiryState);
      return;
    }
    if ("inquiryId" in result && result.inquiryId) {
      setQuery("");
      setPhase("running");
      poll(result.inquiryId);
      // Smooth scroll into results phase
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    }
  }

  const steps = buildSteps(inquiry);
  const readout = (inquiry?.readout as ReadoutEntry[] | null) ?? [];
  const synthesis = inquiry?.synthesis ?? null;
  // Null on runs from before the report pass, which is why the thesis branch
  // below still exists.
  const report = inquiry?.report ?? null;

  return (
    <div>
      <PrivyIdentity onChange={setPrivy} />
      {phase === "idle" ? (
        <section className="app-overview-hero">
          <div className="app-overview-hero-inner">
            <p className="app-overview-kicker label-mono">
              <span className="app-sync-dot" aria-hidden />
              Demand intelligence command
            </p>
            <h1>Find the demand before it becomes the order.</h1>
            <p className="app-overview-hero-intro">
              Describe what you sell. Newintel investigates the companies drifting toward a
              purchase like yours: expansions, permits, filings, capacity moves. Then it states
              the verdict and the window, with the evidence behind every call.
            </p>

            <RequireAuth>
              <form onSubmit={run} className="app-query-box mt-9">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="intent" className="label-mono text-muted-foreground">
                    Describe what you sell or the demand you are chasing
                  </label>
                </div>
                <textarea
                  id="intent"
                  rows={4}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  readOnly={submitting}
                  aria-readonly={submitting}
                  placeholder="e.g. We supply packaging and cold-chain gear — which food processors are expanding right now?"
                  className="mt-3 w-full"
                />
                <div className="app-query-meta">
                  <p aria-live="polite">
                    {submitting
                      ? identity
                        ? "Paying 1 USDC on Base Sepolia, then opening the run…"
                        : "Sending your request…"
                      : identity
                        ? "Signed-in runs are paid in USDC on Base Sepolia."
                        : "One request. Sourced, graded, cited."}
                  </p>
                  <button
                    type="submit"
                    className="app-signal-button shrink-0 inline-flex items-center gap-2"
                    disabled={submitting || !query.trim()}
                  >
                    {submitting ? (
                      <>
                        <span
                          className="inline-block size-3 animate-spin rounded-full border-2 border-ink/40 border-t-ink"
                          aria-hidden
                        />
                        {identity ? "Paying…" : "Sending…"}
                      </>
                    ) : identity ? (
                      "Pay 1 USDC · run"
                    ) : (
                      "Run intelligence"
                    )}
                  </button>
                </div>
              </form>
            </RequireAuth>

            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.filter((ex) => ex !== query).map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuery(example)}
                  className="app-filter-button text-left normal-case tracking-normal"
                >
                  {example.length > 90 ? `${example.slice(0, 88)}…` : example}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="border-b border-border bg-[#0a0f0e]/95 backdrop-blur">
          <div className="mx-auto max-w-[1280px] px-6 py-4 sm:px-8 sm:py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label-mono flex items-center gap-2 text-signal">
                <span className="app-sync-dot" aria-hidden />
                {phase === "running"
                  ? inquiry?.status === "grading"
                    ? "Checking the evidence…"
                    : inquiry?.status === "dispatching"
                      ? "Opening the investigation…"
                      : "Watching the tape…"
                  : phase === "done"
                    ? "Readout ready"
                    : "Run failed"}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (pollRef.current) window.clearInterval(pollRef.current);
                  try { sessionStorage.setItem("prime-layer:dismissed", "1"); } catch {}
                  setPhase("idle");
                  setInquiry(null);
                }}
                className="rounded-sm border border-white/20 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-vellum hover:border-signal hover:text-signal hover:bg-white/10"
              >
                New request
              </button>
            </div>
            {inquiry?.question && (
                <p className="mt-3 max-w-3xl truncate font-mono text-xs leading-relaxed text-ink-muted">
                “{inquiry.question}”
              </p>
            )}
          </div>
        </section>
      )}

      {phase === "idle" && (
        <div className="app-content">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.56fr)]">
            <section className="surface p-5 sm:p-7" aria-labelledby="request-shape">
              <SectionHeading
                eyebrow="How the watch is handled"
                title="A question in. A demand dossier underneath."
              />
              <div className="mt-7 grid gap-5 sm:grid-cols-3">
                <div className="border-t-2 border-signal pt-3">
                  <p className="label-mono text-signal">01 · Intent</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Newintel reads the category, geography and business question.
                  </p>
                </div>
                <div className="border-t-2 border-signal pt-3">
                  <p className="label-mono text-signal">02 · Dispatch</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Your watch fans out across every surface at once.
                  </p>
                </div>
                <div className="border-t-2 border-signal pt-3">
                  <p className="label-mono text-signal">03 · Readout</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Claims are graded after clustering. The thesis returns with its evidence.
                  </p>
                </div>
              </div>
              <div className="mt-8 border-t border-border pt-5">
                <p className="label-mono text-muted-foreground">How your request is handled</p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed">
                  Newintel researches your question through specialist coverage, verifies what comes back, and returns the companies worth your attention,
                  each with the evidence behind it.
                </p>
              </div>
            </section>

            <aside className="surface-dark p-5 sm:p-6" aria-labelledby="dispatch-model">
              <SectionHeading
                dark
                eyebrow="On-demand dispatch"
                title="The right coverage for the open question"
                action={<Bot className="size-5 text-signal" aria-hidden />}
              />
              <div className="mt-7 space-y-5">
                <div className="flex gap-3">
                  <Database className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
                  <p className="text-sm leading-relaxed text-ink-muted">
                    Work starts only when you ask. Minutes to source, then submit.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Layers3 className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
                  <p className="text-sm leading-relaxed text-ink-muted">
                    Duplicate citations collapse into one source. Independence is what earns confidence.
                  </p>
                </div>
                <div className="flex gap-3">
                  <ScanLine className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
                  <p className="text-sm leading-relaxed text-ink-muted">
                    The output is an impact assessment, not a price target or a hot tip.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}

      {phase !== "idle" && (
        <div className="app-content">
          <div className="grid gap-8 xl:grid-cols-[minmax(18rem,0.6fr)_minmax(0,1.4fr)]">
            <section className="surface-dark p-5 sm:p-6" aria-label="System operations">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="label-mono text-signal">System operations</p>
                  <h2 className="mt-2 font-display text-2xl text-vellum">The readout in motion</h2>
                </div>
                <span className="app-sync-dot mt-1" aria-hidden />
              </div>
              <ol className="mt-7">
                {steps.map((step, index) => {
                  const state =
                    step.state === "done" ? "done" : step.state === "active" ? "active" : "idle";
                  const isCurrent = steps.findIndex((s) => s.state === "active") === index;
                  return (
                    <li key={step.label} className="app-system-step" data-state={state}>
                      <p className="app-system-step-label">{step.label}</p>
                      <ul className="app-system-step-lines">
                        {(state !== "idle" || isCurrent) &&
                          step.lines.map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-7 border-t border-ink-border pt-4 font-mono text-[0.66rem] leading-relaxed text-ink-muted">
                One readout. Every claim carries its source.
              </p>
            </section>

            <section aria-label="Ranked results">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <h2 className="mt-2 font-display text-2xl">What came back</h2>
                </div>
                <div className="flex items-center gap-3">
                  {phase === "done" && <StatusPill tone="verified" label="Evidence attached" />}
                  {phase === "failed" && <StatusPill tone="flagged" label="Run failed" />}
                </div>
              </div>

              {phase === "done" && report ? (
                /* The intelligence report is the deliverable. Everything below
                   this branch is the older per-exposure thesis, kept only for
                   runs recorded before the report pass existed. */
                <div className="mt-5">
                  <ReportView report={report} />
                </div>
              ) : phase === "done" && synthesis && synthesis.recommendations.length > 0 ? (
                <div className="mt-5 space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <p className="font-mono text-xs text-muted-foreground">
                    This run predates the intelligence report, so what follows is the older
                    per-exposure thesis.
                  </p>
                  {synthesis.preamble && (
                    <p className="max-w-3xl border-l-2 border-signal pl-4 text-sm leading-relaxed text-muted-foreground">
                      {synthesis.preamble}
                    </p>
                  )}
                  <ol className="space-y-4">
                    {synthesis.recommendations.map((rec, index) => {
                      const verdict = (rec as { verdict?: string }).verdict ?? "unclear";
                      const marketCall = (rec as { marketCall?: string }).marketCall ?? "";
                      const timeframe = (rec as { timeframe?: string }).timeframe ?? "";
                      const marketLines = (rec as { marketLines?: string[] }).marketLines ?? [];
                      const verdictLabel =
                        verdict === "priced"
                          ? "Priced in · no edge"
                          : verdict === "underpriced"
                            ? "Not yet priced"
                            : "Unclear";
                      return (
                      <li key={`${rec.company}-${index}`} className="surface p-5 sm:p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="label-mono text-signal">
                              {String(index + 1).padStart(2, "0")} · Opportunity · {verdictLabel}
                            </p>
                            <h3 className="mt-2 font-display text-2xl leading-tight">
                              {rec.company}
                            </h3>
                            {rec.title && rec.title !== rec.company && (
                              <p className="mt-1 text-sm font-medium">{rec.title}</p>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-3xl text-signal">{rec.confidence}%</p>
                            <p className="label-mono text-muted-foreground">confidence</p>
                          </div>
                        </div>
                        <p className="mt-4 max-w-3xl text-sm leading-relaxed">{rec.body}</p>
                        {(marketCall || timeframe) && (
                          <div className="mt-4 rounded-sm border border-border bg-slate/20 p-4" aria-label="Market call">
                            {marketCall && (
                              <p className="text-sm leading-relaxed">
                                <span className="label-mono text-signal">Market call · </span>
                                {marketCall}
                              </p>
                            )}
                            {timeframe && (
                              <p className="mt-2 font-mono text-xs text-muted-foreground">
                                TIMEFRAME {timeframe}
                              </p>
                            )}
                            {marketLines.length > 0 && (
                              <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                                {marketLines.slice(0, 4).map((line) => (
                                  <li key={line}>{line}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                        {rec.sources.length > 0 && (
                          <div className="mt-5 border-t border-border pt-4">
                            <ul className="flex flex-wrap gap-2">
                              {rec.sources.map((source, sIndex) => (
                                <li key={`${source.url}-${sIndex}`}>
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={source.url}
                                    className="inline-flex max-w-[220px] items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 font-mono text-xs text-signal hover:border-signal hover:bg-slate/30"
                                  >
                                    <span className="truncate">{source.label || source.url}</span>
                                    <ArrowUpRight className="size-3 shrink-0" aria-hidden />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                      );
                    })}
                  </ol>
                </div>
              ) : phase === "done" && synthesis ? (
                <div className="surface mt-5 p-8 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <p className="font-display text-xl">
                    Honestly, nothing worth recommending came back.
                  </p>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                    {synthesis.preamble ||
                      "We looked everywhere and, honestly, nothing solid came back. That usually means no fresh demand is forming around this topic right now, not that something broke. Try another question, or check back soon."}
                  </p>
                </div>
              ) : phase === "done" && readout.length > 0 ? (
                <div className="surface mt-5 p-8 text-center animate-in fade-in duration-500">
                  <p className="label-mono text-signal">Composing your thesis</p>
                  <p className="mt-3 font-display text-2xl">
                    Evidence graded. Writing the readout.
                  </p>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                    {readout.length} companies ranked from {inquiry?.sourcesClustered ?? 0} source
                    clusters. Newintel is now writing the causal chain behind each one.
                    This usually takes under a minute.
                  </p>
                  <div className="mx-auto mt-6 max-w-md space-y-2" aria-hidden>
                    <div className="h-3 w-3/4 mx-auto animate-pulse rounded bg-border" />
                    <div className="h-3 w-1/2 mx-auto animate-pulse rounded bg-border" />
                  </div>
                </div>
              ) : phase === "done" ? (
                <div className="surface mt-5 p-8 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <p className="font-display text-xl">Nothing came back this time.</p>
                  <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                    We looked everywhere and, honestly, nothing solid came back.
                    That usually means no fresh demand is forming around this topic right now, not that
                    something broke. Try another question, or check back soon. The moment something moves,
                    it'll show up here.
                  </p>
                </div>
              ) : phase === "running" ? (
                <div className="mt-5 space-y-4">
                  <div className="surface p-5 sm:p-6">
                    <p className="label-mono text-signal">Watching the tape…</p>
                    <h3 className="mt-2 font-display text-xl">Your watch is live. Give us a moment.</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Your watch is live across every surface. An in-depth investigation
                      typically takes about 2 to 3 minutes: sourcing, then clustering, then
                      grading, then your readout. Patience here is part of the product.
                      The readout appears the moment grading finishes.
                    </p>
                    {inquiry?.status === "collecting" && (
                      <p className="mt-3 font-mono text-xs text-signal" aria-live="polite">
                        {inquiry.wave === 1
                          ? `Wave 1 of 2 · broad sweep${inquiry.liveClaims != null ? ` · ${inquiry.liveClaims} claims in` : ""}${inquiry.liveAgents != null && inquiry.agentsMatched ? ` · ${inquiry.liveAgents}/${inquiry.agentsMatched} agents back` : ""}`
                          : inquiry.wave === 2
                            ? `Wave 2 of 2 · aimed hunt${inquiry.liveClaims != null ? ` · ${inquiry.liveClaims} claims in` : ""}${inquiry.liveAgents != null && inquiry.agentsMatched ? ` · ${inquiry.liveAgents}/${inquiry.agentsMatched} agents back` : ""}`
                            : inquiry.liveClaims != null
                              ? `${inquiry.liveClaims} claims in so far`
                              : null}
                        {inquiry.elapsedSeconds != null && inquiry.elapsedSeconds > 5
                          ? ` · ${Math.floor(inquiry.elapsedSeconds / 60)}m ${inquiry.elapsedSeconds % 60}s elapsed`
                          : null}
                      </p>
                    )}
                    {inquiry?.status === "grading" && (
                      <p className="mt-3 font-mono text-xs text-signal" aria-live="polite">
                        Grading {inquiry.claimsReceived ?? inquiry.liveClaims ?? 0} claims · connecting evidence · writing your report
                        {inquiry.elapsedSeconds != null ? ` · ${Math.floor(inquiry.elapsedSeconds / 60)}m ${inquiry.elapsedSeconds % 60}s in` : null}
                      </p>
                    )}
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="label-mono text-muted-foreground">While you wait</p>
                      <RotatingFacts />
                    </div>
                    <p className="mt-4 font-mono text-[0.65rem] text-ink-muted">
                      Tip: you can switch tabs. We keep polling and will show the readout when it lands.
                    </p>
                  </div>
                  <SourcingCountdown
                    deadlineIso={inquiry?.windowClosesAt ?? null}
                    windowSeconds={inquiry?.windowSeconds ?? 150}
                    grading={inquiry?.status === "grading"}
                    claims={inquiry?.claimsReceived ?? inquiry?.liveClaims ?? 0}
                    sources={inquiry?.sourcesClustered ?? 0}
                  />
                </div>
              ) : phase === "failed" ? (
                <div className="surface mt-5 p-8 text-center animate-in fade-in duration-300">
                  <p className="font-display text-xl">Run failed</p>
                  <p className="mx-auto mt-3 max-w-md font-mono text-xs leading-relaxed text-muted-foreground">
                    {inquiry?.error ?? "Something went wrong on our end."}
                  </p>
                  {identity ? (
                    <p className="mt-2 font-mono text-[0.65rem] text-signal">
                      1 free retry added. Try again whenever you are ready.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <div className="h-24 rounded-sm border border-border bg-slate/30 animate-pulse" />
                  <div className="h-24 rounded-sm border border-border bg-slate/20 animate-pulse [animation-delay:150ms]" />
                  <div className="h-24 rounded-sm border border-border bg-slate/10 animate-pulse [animation-delay:300ms]" />
                  <p className="pt-2 text-center font-mono text-[0.65rem] text-ink-muted">
                    Watching. Results slide in as soon as the signals are ranked
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

type LiveStep = { label: string; lines: string[]; state: "idle" | "active" | "done" };

function buildSteps(inquiry: InquiryState | null): LiveStep[] {
  const status = inquiry?.status ?? "dispatching";
  const order = ["dispatching", "collecting", "grading", "complete"];
  const reached = (stage: string) => order.indexOf(status) >= order.indexOf(stage);

  return [
    {
      label: "Mapping exposure",
      state: "done",
      lines: [
        ...(inquiry?.category ? [inquiry.category] : []),
        ...(inquiry?.geography ? [inquiry.geography] : []),
      ],
    },
    {
      label: "Fanning out",
      state: reached("collecting") ? "done" : reached("dispatching") ? "active" : "idle",
      lines: [
        `Sourcing window · ${inquiry?.windowSeconds ?? 150}s${inquiry?.wave ? ` · wave ${inquiry.wave}/2` : ""}`,
        "Every relevant surface around the question is investigated at once",
      ],
    },
    {
      label: "Evidence in",
      state: reached("grading") ? "done" : reached("collecting") ? "active" : "idle",
      lines: [
        `${inquiry?.claimsReceived ?? inquiry?.liveClaims ?? 0} claims submitted${inquiry?.liveAgents != null && inquiry?.agentsMatched ? ` · ${inquiry.liveAgents}/${inquiry.agentsMatched} agents` : ""}`,
        `${inquiry?.sourcesClustered ?? 0} independent source clusters`,
      ],
    },
    {
      label: "Ranking impact",
      state: status === "complete" ? "done" : reached("grading") ? "active" : "idle",
      lines:
        status === "complete"
          ? [`${((inquiry?.readout as ReadoutEntry[] | null) ?? []).length} assessments in readout`]
          : ["Weighting by independence and reliability"],
    },
  ];
}
