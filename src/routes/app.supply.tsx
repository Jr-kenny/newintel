import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Boxes, CheckCircle2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { PrivyIdentity, type PrivyIdentityInfo } from "@/components/app/privy-identity";
import { MetricBlock, SectionHeading } from "@/components/app/AppUI";
import { listSupplyLive, type SupplyView } from "@/lib/orchestrator/workspace";
import { addSupplyRecord } from "@/lib/orchestrator/fns";
import { RequireAuth, RequireAuthAction } from "@/components/app/auth-gate";

export const Route = createFileRoute("/app/supply")({
  head: () => ({
    meta: [
      { title: "Supply · Newintel workspace" },
      {
        name: "description",
        content:
          "Define what you supply so Newintel can match newly detected demand against your capacity, markets and contract profile.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Supply,
});

function Supply() {
  const [privy, setPrivy] = useState<PrivyIdentityInfo>({
    authenticated: false,
    email: null,
    walletAddress: null,
    firstWallet: null,
  });
  const identity = privy.email ?? privy.walletAddress ?? null;
  const [records, setRecords] = useState<SupplyView[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [market, setMarket] = useState("Regional");
  const [target, setTarget] = useState("Semiconductors");
  const [capacity, setCapacity] = useState("");

  useEffect(() => {
    if (!identity) {
      setRecords([]);
      return;
    }
    void listSupplyLive({ data: { identity } }).then((rows) => {
      setRecords(rows);
    });
  }, [identity]);

  async function addRecord(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !capacity.trim() || saving) return;
    setSaving(true);
    try {
      await addSupplyRecord({
        data: {
          name: `${name.trim()} (${capacity.trim()})`,
          markets: [market],
          targets: [target.trim()],
          ...(identity ? { identity } : {}),
        },
      });
      setName("");
      setCapacity("");
      setAdding(false);
      setRecords(await listSupplyLive({ data: { ...(identity ? { identity } : {}) } }));
    } finally {
      setSaving(false);
    }
  }

  const view = records ?? [];

  return (
    <div>
      <PrivyIdentity onChange={setPrivy} />
      <PageHeader
        eyebrow="Supply"
        title="What you supply"
        intro="This is not a public portfolio. It is the private reference Newintel uses to match newly detected demand against your actual capacity, markets and contract profile."
      >
        <RequireAuthAction signInLabel="Sign in to add supply">
          <button
            type="button"
            className="app-dark-button shrink-0"
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {adding ? "Close form" : "Add supply record"}
          </button>
        </RequireAuthAction>
      </PageHeader>

      <div className="app-content">
        {adding && (
          <RequireAuth>
            <section className="surface-dark mb-8 p-5 sm:p-6" aria-labelledby="add-supply">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="label-mono text-signal">New supply record</p>
                  <h2 className="mt-2 font-display text-2xl text-vellum">
                    Give the graph something concrete to watch
                  </h2>
                </div>
                <Boxes className="size-5 text-signal" aria-hidden />
              </div>
              <form onSubmit={addRecord} className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label>
                  <span className="app-form-label text-ink-muted">What you sell</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    className="app-input mt-2 border-ink-border bg-slate text-vellum placeholder:text-ink-subtle"
                    placeholder="e.g. industrial packaging"
                  />
                </label>
                <label>
                  <span className="app-form-label text-ink-muted">Capacity / detail</span>
                  <input
                    value={capacity}
                    onChange={(event) => setCapacity(event.target.value)}
                    required
                    className="app-input mt-2 border-ink-border bg-slate text-vellum placeholder:text-ink-subtle"
                    placeholder="e.g. 40k units / month, West Africa"
                  />
                </label>
                <label>
                  <span className="app-form-label text-ink-muted">Primary market</span>
                  <select
                    value={market}
                    onChange={(event) => setMarket(event.target.value)}
                    className="app-select mt-2 border-ink-border bg-slate text-vellum"
                  >
                    <option>Regional</option>
                    <option>National</option>
                    <option>Export</option>
                    <option>All markets</option>
                  </select>
                </label>
                <label>
                  <span className="app-form-label text-ink-muted">Target exposure</span>
                  <input
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    required
                    className="app-input mt-2 border-ink-border bg-slate text-vellum placeholder:text-ink-subtle"
                    placeholder="e.g. Semiconductors"
                  />
                </label>
                <div className="sm:col-span-2 lg:col-span-4">
                  <button type="submit" className="app-signal-button">
                    Save to supply <ArrowUpRight className="size-3.5" aria-hidden />
                  </button>
                  <p className="mt-3 font-mono text-[0.64rem] text-ink-muted">
                    Saved to your workspace and matched against fresh events on the graph.
                  </p>
                </div>
              </form>
            </section>
          </RequireAuth>
        )}

        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <SectionHeading eyebrow="Supply context" title="Your side of the graph" />
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Newintel uses these entries to rank fresh events against what you hold.
              The match stays private to your workspace.
            </p>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className="size-4 text-verified" aria-hidden />
            <span className="font-mono text-xs">{view.length} records active</span>
          </div>
        </div>

        <ul className="mt-6 grid gap-4 lg:grid-cols-2">
          {records === null && (
            <li className="surface p-8 text-center text-sm text-muted-foreground">
              Loading supply…
            </li>
          )}
          {records !== null && view.length === 0 && (
            <li className="surface p-8 text-center text-sm text-muted-foreground">
              {!identity ? (
                <>Sign in to see your supply. Entries belong to the workspace that saved them.</>
              ) : (
                <>
                  No supply records yet — add what you sell and Newintel matches new demand against
                  it.
                </>
              )}
            </li>
          )}
          {view.map((record, index) => (
            <li
              key={record.id}
              className={`surface overflow-hidden ${index === 0 ? "border-signal/50" : ""}`}
            >
              <div className="border-l-2 border-signal p-5 sm:p-6">
                <div className="flex items-start justify-between gap-5">
                  <div>
                      <p className="label-mono text-muted-foreground">
                        Supply record · {String(index + 1).padStart(2, "0")}
                      </p>
                    <h2 className="mt-2 font-display text-2xl leading-none">{record.name}</h2>
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      {record.markets.join(" / ")} · {record.targets.join(" / ")}
                    </p>
                  </div>
                  <Boxes className="size-5 shrink-0 text-signal" aria-hidden />
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
                  {record.detail.map((detail) => (
                    <MetricBlock key={detail.label} label={detail.label} value={detail.value} />
                  ))}
                    <MetricBlock label="Markets" value={record.markets.join(" / ")} />
                    <MetricBlock label="Target exposure" value={record.targets.join(" / ")} />
                </div>

                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
                  <div>
                    <p className="label-mono text-muted-foreground">Current matches</p>
                    <p className="mt-2 font-mono text-2xl text-signal">{record.matches}</p>
                  </div>
                  <div>
                    <p className="label-mono text-muted-foreground">High confidence</p>
                    <p className="mt-2 font-mono text-2xl text-verified">{record.highConfidence}</p>
                  </div>
                </div>

                <Link
                  to="/app"
                  className="mt-6 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.1em] text-signal hover:text-ink"
                >
                  Run an investigation against this record <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8 grid gap-5 border-t border-border pt-6 md:grid-cols-3">
          <div>
            <p className="label-mono text-muted-foreground">Private by default</p>
            <p className="mt-2 text-sm leading-relaxed">
              Supply records help rank your assessments and are not public listings.
            </p>
          </div>
          <div>
            <p className="label-mono text-muted-foreground">Matched to movement</p>
            <p className="mt-2 text-sm leading-relaxed">
              A supply record becomes interesting when a fresh event creates matching need.
            </p>
          </div>
          <div>
            <p className="label-mono text-muted-foreground">No static profiles</p>
            <p className="mt-2 text-sm leading-relaxed">
              The graph cares about exposure, timing and the reason a move could form.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
