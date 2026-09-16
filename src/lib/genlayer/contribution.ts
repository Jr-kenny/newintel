/**
 * Agent-settlement packages for the GenLayer judge.
 *
 * Scope: agent contribution → payout weights only.
 * The human/business path never waits on this contract — buyers already
 * have the readout from the orchestrator. GenLayer does not score, refund,
 * or protect them.
 *
 *   1. Agent claim → record_finding (store)
 *   2. Final intel → business (done) + record_final (matching input)
 *   3. adjudicate → agent weights → USDC to agent wallets
 */

export type AgentObservation = {
  company?: string | null;
  /** Street / site / area. City alone is thin — not full intelligence. */
  location?: string | null;
  contact?: string | null;
  event: string;
  sources: string[];
  observed: string;
  /**
   * Sibyl reliability ledger — how often this agent's past findings were
   * recalled and held. The judge uses it as a score multiplier, not a
   * substitute for evidence in this cycle.
   */
  verified_recalls?: number;
  discoveries?: number;
};

export type AgentSubmissionPackage = {
  agent_id: string;
  observations: AgentObservation[];
};

export type ContributionWeights = {
  inquiry_id: string;
  ready?: boolean;
  weights: Record<string, number>;
  contributions: {
    agent_id: string;
    weight: number;
    fields_used: string[];
    matched_final: string[];
    note: string;
  }[];
  merges: string[];
  source_overlaps?: string[];
  note: string;
};

export function packageObservation(input: {
  company?: string | null;
  claim: string;
  evidenceJson: string;
}): AgentObservation {
  let evidence: { item: string; source: string; observed: string }[] = [];
  try {
    evidence = JSON.parse(input.evidenceJson || "[]");
  } catch {
    evidence = [];
  }
  const text = `${input.claim} ${evidence.map((e) => e.item).join(" ")}`;
  // Prefer a street-ish token; city names alone stay as location but are thin.
  const street =
    text.match(
      /\b(\d+\s+[A-Za-z][A-Za-z\s]{2,30}(street|st|road|rd|avenue|ave|lane|close|way|drive))\b/i,
    )?.[0] ??
    text.match(/\b(plot\s*\d+|block\s*[A-Z0-9]+|site\s+[A-Za-z0-9\-]+)/i)?.[0] ??
    null;
  const city =
    text.match(
      /\b(accra|lagos|abuja|kano|nairobi|manchester|tampa|delaware|ghana|nigeria|kenya)\b/i,
    )?.[0] ?? null;
  const contact =
    text.match(/\b(contact|engineer|builder|contractor|phone|@|https?:\/\/)[^\n]{0,40}/i)?.[0] ??
    null;

  return {
    company: input.company || null,
    location: street ?? city,
    contact,
    event: input.claim.slice(0, 300),
    sources: evidence.map((e) => e.source).filter(Boolean),
    observed: evidence[0]?.observed ?? new Date().toISOString().slice(0, 10),
  };
}

export function packageFinalIntelligence(input: {
  question: string;
  opportunities: {
    company: string;
    location?: string | null;
    need: string;
    summary: string;
  }[];
}): Record<string, unknown> {
  return {
    question: input.question,
    opportunities: input.opportunities.map((o) => ({
      company: o.company,
      location: o.location ?? null,
      need: o.need,
      summary: o.summary,
    })),
  };
}

/**
 * Field-richness fallback when GenLayer is unreachable.
 * Same-source multi-agent still gets weight (not zero); unique fields add more.
 */
export function fallbackWeights(
  packages: AgentSubmissionPackage[],
  finalIntel: { opportunities: { company: string; location?: string | null }[] },
): ContributionWeights {
  // Count how many agents share each source URL — overlap reduces, never kills.
  const sourceHits = new Map<string, number>();
  for (const p of packages) {
    for (const o of p.observations) {
      for (const s of o.sources) {
        sourceHits.set(s, (sourceHits.get(s) ?? 0) + 1);
      }
    }
  }

  const raw: Record<string, number> = {};
  let i = 0;
  while (i < packages.length) {
    const p = packages[i]!;
    let score = 0;
    let j = 0;
    while (j < p.observations.length) {
      const o = p.observations[j]!;
      score += 1; // every detailed observation is useful
      if (o.location) score += 1;
      if (o.company) score += 2;
      if (o.contact) score += 3;
      // Same source shared with other agents → reduce this observation.
      let k = 0;
      while (k < o.sources.length) {
        const hits = sourceHits.get(o.sources[k]!) ?? 1;
        if (hits > 1) score *= 0.7;
        k += 1;
      }
      j += 1;
    }
    raw[p.agent_id] = score;
    i += 1;
  }

  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  const weights: Record<string, number> = {};
  if (total > 0) {
    for (const [k, v] of Object.entries(raw)) {
      weights[k] = Math.round((v / total) * 10000) / 10000;
    }
  }

  return {
    inquiry_id: "",
    ready: true,
    weights,
    contributions: packages.map((p) => ({
      agent_id: p.agent_id,
      weight: weights[p.agent_id] ?? 0,
      fields_used: p.observations.flatMap((o) =>
        [
          o.event ? "event" : null,
          o.location ? "location" : null,
          o.company ? "company" : null,
          o.contact ? "contact" : null,
        ].filter(Boolean) as string[],
      ),
      matched_final: finalIntel.opportunities.map((o) => o.company),
      note: "deterministic fallback — GenLayer not called",
    })),
    merges: [],
    source_overlaps: Array.from(sourceHits.entries())
      .filter(([, n]) => n > 1)
      .map(([s, n]) => `${s} cited by ${n} agents — weights reduced, all still valid`),
    note: "fallback: field richness + same-source reduction; not consensus-adjudicated",
  };
}

/** Hard gate — never call payouts without a ready verdict. */
export function assertPayoutReady(verdict: ContributionWeights | null): Record<string, number> {
  if (!verdict || verdict.ready === false) {
    throw new Error("Payout blocked: contribution adjudication not ready");
  }
  if (!verdict.weights || Object.keys(verdict.weights).length === 0) {
    throw new Error("Payout blocked: empty contribution weights");
  }
  return verdict.weights;
}
