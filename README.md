# Newintel

**Find the demand before it becomes the order.**

Newintel is event-driven demand intelligence. You describe what you sell and the network investigates where commercial demand is forming — expansions, permits, filings, capacity moves — then states the verdict and the window, with evidence behind every call.

**A full investigation takes about 7 minutes.** Ten specialists search in parallel, the system grades and connects what comes back, then writes one report. The screen shows progress throughout. Good intelligence is worth the wait.

```mermaid
flowchart LR
    Q[Business question] --> H[Demand hypotheses]
    H --> PI[Parallel investigation]
    PI --> EVT[Event + need path]
    EVT --> V[Verification and grading]
    V --> D[Dossier]
    D --> OP[Ranked opportunities]
```

## The problem it solves

A company with $500k of electrical appliances will not find its buyers by searching for "electrical equipment buyers". The buyers are not looking yet. They are building a hotel, expanding a factory, fitting out a hospital. Demand exists because an event created it.

Search engines return pages. Lead databases return contacts. Neither answers what matters commercially:

- where demand is forming
- what event created the demand
- who is involved
- when the purchase is likely
- what evidence proves it

Newintel takes a plain-language request such as

> I have $500k of electrical appliances. Find companies likely to need them.

and investigates the market behind it. It looks for situations that create demand — new facilities, expansions, construction, refurbishment, procurement — and turns what it finds into ranked opportunities with reasoning and verifiable sources.

## How we built it

Newintel is an intelligence network, not a search box. One orchestrator directs ten specialists. Each run generates demand hypotheses, investigates in parallel, and synthesizes what comes back into one recommendation per company.

```mermaid
flowchart LR
    Q[Question] --> H[Demand hypotheses]
    H --> PI[Parallel investigation]
    PI --> CS[Claims and sources]
    CS --> D[Deduplication]
    D --> V2[Verification]
    V2 --> SC[Scoring]
    SC --> SYN[Synthesis]
    SYN --> OPP[Ranked opportunity]
```

The flow is:

**Question → demand hypotheses → specialist investigation → signals → evidence → verification → commercial intent → ranked opportunities**

## How it thinks

A reasoning objective, not a checklist. Newintel searches for the circumstances that create demand rather than the inventory itself.

- **Don't investigate the inventory. Investigate the world that creates need for it.**
- **Never restrict investigation to predefined entities.** The graph expands wherever evidence creates a meaningful connection.
- **Prioritize like an analyst:** economic materiality, causal proximity, magnitude, probability, timing, novelty, evidence quality.
- **The chain is the intelligence, not a score.** Every conclusion reads as event, need path, timing, evidence, conclusion.
- **A closed window is a first-class answer.** Interesting signal, no open buying window — say so.

### Demand hypotheses

Each run opens with a short broad sweep. The orchestrator then maps what could create demand from what the sweep actually returned: who uses the goods at volume, what event triggers buying, where that event would be reported.

### Specialist agents

Each specialist is bounded to a type of intelligence. Together they cover different surfaces of the market:

- **Web Research** - general web and news investigation
- **Social Signal** - public statements that indicate material developments
- **Project Intel** - construction, infrastructure and development projects
- **Company Intel** - organizations and their activities
- **Person/Role Intel** - public professional roles and relationships
- **Procurement** - tenders, contracts and purchasing activity
- **Media / YouTube** - interviews, tours and audiovisual sources, with transcript extraction
- **Verification** - independent verification of important claims
- **Synthesis** - connecting evidence into coherent theses
- **Prime Signals** - first-party connector covering Google News RSS, GDELT and SEC EDGAR filings

The orchestrator assigns work. Specialists return structured claims. The orchestrator decides what becomes an assessment, what needs verification, and what triggers further investigation.

### The exposure graph

One event fans into many exposures:

```
Hyperscale AI buildout
        │
        ├── GPUs → NVIDIA
        ├── Memory → Micron
        ├── Servers → Dell
        ├── Networking → Broadcom
        └── Power → infrastructure names
```

The graph holds Company → Customers → Suppliers → Partners → Projects → Industries → Related assets. An event three levels away from the watched ticker can still surface as a ranked assessment without anyone ever searching the ticker directly.

### Direct and indirect signals

A **direct** signal: NVIDIA announces a major customer. An **indirect** signal: Microsoft announces a massive AI data-center expansion Microsoft → infrastructure → GPU demand → NVIDIA → TSMC. Every assessment carries its impact path, with evidence supporting each edge.

### Evidence

Every meaningful claim carries evidence and a source. The system keeps a clear boundary between what a source confirms and what the system infers from it. A source date, URL and observed item support each claim, and the readout shows both the fact and the inference so the reader can follow the reasoning.

### Duplicate evidence

Five specialists citing the same article count as one source, not five independent confirmations. Source clustering canonicalizes URLs and groups citations of the same underlying document into a single cluster. Independent sources increase confidence. Repeated citations do not.

### Recursive investigation

A discovery can trigger controlled follow-up investigation. Finding a data-center expansion, for example, can lead to an investigation of the contractors, the equipment suppliers, or the power arrangements. Recursion is bounded by depth, source count and token budget, and terminates on diminishing returns or duplicate detection.

### Thesis first, price second

The sequence is strict:

**World → Event → Economic impact → Exposure → Thesis → Market price**

Never the reverse. The thesis is formed off-market and independently then contextualized against the market. Otherwise you build a momentum bot wearing an intelligence costume.

### The market check (Binance Agent OS)

Only after the thesis exists, Newintel queries live market context through the Binance Agent OS MCP server: current price, recent movement, volume, and the user's watched position inside a permissioned sub-account. Read-only. No withdrawals, ever. The agent proposes; the trader decides.

A positioning gauge (`src/lib/binance/market-test.ts`) measures where price already sits: range position, 14-session run, daily wobble. It emits measurements, never verdicts. It is built to grow: reverse-DCF and peer-relative checks slot in as functions beside it once fundamentals arrive.

Typical readout line:

> NVDA up 2% despite a fresh hyperscale expansion announcement; the information may not be fully reflected in the observed price. Related exposure: MU, DELL, AVGO.

### The output: Market Impact Assessment

Not buy/sell. Each assessment carries impact, magnitude, confidence, event freshness, observed price reaction, related exposures, the reasoning, and what could invalidate it. An analytical assessment, not a prediction.

A note on voice: the live application speaks only in outcomes. Theses, evidence, confidence. The machinery behind them, ten specialists, orchestration, clustering, grading, lives here in this document and in `soul.md`, where it belongs. A trader should never need to know what an agent is.

## Technologies we used

Application and infrastructure:

- TanStack Start (React)
- TypeScript
- Vite
- Bun
- Vercel
- libSQL
- Drizzle ORM
- Tailwind
- Radix
- TanStack Router

Intelligence:

- Google News RSS
- GDELT
- SEC EDGAR
- YouTube Data API
- YouTube timedtext transcripts
- Custom scoring and clustering
- Evidence graph
- Exposure hypothesis generation
- Recursive investigation
- `soul.md` synthesis

Market layer:

- Binance Agent OS MCP read-only market context (prices, volume, positions)
- LLM grading of claim relevance and evidence quality, plus LLM connection of evidence into causal chains
- ERC-7857 Agentic ID identity for participating specialists
- Sibyl memory intelligence that compounds across inquiries instead of restarting at zero

## Sibyl memory layer

Newintel's intelligence compounds across watches instead of restarting at zero on every inquiry. A persistent memory substrate organized as six stores source registry, claim store, reliability ledger, exposure graph nodes, inquiry store, follow-up queue means the second watch on a ticker is better than the first: warm briefs, targeted re-checks, and claims that re-verify themselves without anyone asking.

## Challenges we ran into

### Reliable intelligence from multiple specialists

A distributed network can generate more data without generating better intelligence. Specialization, structured claims, orchestration and verification keep it honest: one surface per specialist, one common claim shape, and the orchestrator decides what advances.

### Duplicate sources

Multiple specialists independently finding the same article inflates confidence if unhandled. Source clustering canonicalizes and groups citations of the same document so confidence grows only with genuinely independent corroboration.

### Thesis discipline

It is tempting to let price action write the narrative. The pipeline enforces the order instead: world first, market last. Anything that cannot show an exposure path from event to ticker does not become an assessment.

### Depth vs speed

Ten specialists need time to investigate independently, but the product must stay practical. Parallel research and bounded recursion keep a full run to about 7 minutes: a short opening sweep, an aimed second wave of a few minutes, then grading, connection, and the report.

## What we learned

### Events beat tickers

Starting from the situations that move stocks produces stronger intelligence than screening the stocks themselves. Framing around events finds exposure that keyword matching misses.

### Independent evidence matters more than volume

Repeated citations are not corroboration. Confidence should increase with genuinely independent sources, not with the number of times one source is reported.

### Exposure context matters

A signal becomes tradable when combined with the impact path, the freshness, the observed market reaction and the invalidation conditions. Context turns a mention into a thesis.

### Facts and inference must remain separate

Show what a source confirms and what the system concludes as two distinct things. That boundary makes the output verifiable and the reasoning inspectable.

### Intelligence compounds

Entities, relationships, events and evidence accumulate into a picture of forming exposure rather than isolated answers. The evidence graph makes that accumulation useful over time.

## Status

Newintel runs end to end today:

- Natural language watch requests with exposure hypothesis generation
- Ten first-party specialists investigating in parallel
- Structured claims with evidence and sources
- Source clustering and deduplication
- Deterministic grading plus LLM grading of relevance and evidence quality
- Bounded recursive follow-up investigation
- Evidence and exposure graphs with persisted causal chains
- One intelligence report per run: executive first, evidence with our read, synthesis chains, four horizons, scenarios with invalidation, bottom line
- Read-only market context via Binance Agent OS MCP, persisted per inquiry
- Positioning gauge feeding the market test; verdicts stay with the thesis
- Outcome reflection (`bun scripts/reflect-outcomes.ts`): past verdicts judged against later price action, lessons written back to Sibyl memory
- ERC-7857 identities for participating specialists
- Sibyl memory across inquiries

Built for Track A of the Binance Agent OS Mini Hackathon.

## For agents (MCP + HTTP)

Newintel runs next to the Binance MCP server inside your own agent session. Add it once:

```bash
claude mcp add newintel --transport http https://newintelislive.vercel.app/mcp
```

VS Code picks up both servers from the repo's `.vscode/mcp.json`. Cursor takes the same URL as a Streamable HTTP server. Then call `newintel_read` for market context, `newintel_assess` for the thesis, `newintel_clusters` for evidence without verdicts, `newintel_thesis_changes` for what moved, `newintel_conflicting` for the counter-case, `newintel_evidence` to drill into one thread, and `newintel_investigate` plus `newintel_inquiry` to run the full ten-specialist grid. Pass your own Binance tool output as `binance_market_data` and that leg reports caller-supplied. Every tool has an HTTP twin under `/api/market`. Full contract in `skills/newintel/SKILL.md`.

## Built by Prime Isles

Prime Isles is an independent engineering team focused on AI, autonomous agents, Web3, developer infrastructure, and building systems that turn complex information into useful action.
