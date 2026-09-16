/**
 * Which registered agents belong to Newintel.
 *
 * Newintel and StockIntel share one sqld on the AWS box. Each app has its own
 * ten services (StockIntel 8790-8799, Newintel 8810-8819). Dispatch, roster
 * and counts must never treat the other app's units as part of this grid, or
 * a "10 agent" product shows 20 and half the claims come from the wrong
 * research body.
 *
 * Local/dev endpoints (localhost, 127.0.0.1) count as Newintel unless they
 * sit on the StockIntel port band.
 */

const STOCKINTEL_PORT_RE = /:(?:879[0-9])\//;
const NEWINTEL_PORT_RE = /:(?:881[0-9])\//;

export type GridAgent = {
  id: string;
  name?: string | null;
  endpoint: string;
  status?: string | null;
  /** Optional DB column once migration has run. Port-band check is the fallback. */
  grid?: string | null;
};

/** True when this registration is a Newintel unit, not a StockIntel twin. */
export function isNewintelAgent(agent: Pick<GridAgent, "endpoint" | "name" | "grid">): boolean {
  if (agent.grid) return agent.grid === "newintel";
  const endpoint = (agent.endpoint || "").trim();
  if (!endpoint) return false;
  if (NEWINTEL_PORT_RE.test(endpoint)) return true;
  if (STOCKINTEL_PORT_RE.test(endpoint)) return false;
  // localhost / 127.0.0.1 / pull-mode and public newintel hosts
  const host = (() => {
    try {
      return new URL(endpoint).hostname;
    } catch {
      return "";
    }
  })();
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (endpoint === "pull" || endpoint === "poll" || endpoint.startsWith("pull://")) return true;
  // Unknown public endpoint: only accept if the name is not a stockintel twin.
  const name = (agent.name || "").toLowerCase();
  if (name.includes("stockintel")) return false;
  return !STOCKINTEL_PORT_RE.test(endpoint);
}

/** Online agents this app is allowed to dispatch to. */
export function newintelGrid<T extends GridAgent>(all: readonly T[]): T[] {
  return all.filter((agent) => agent.status === "online" && isNewintelAgent(agent));
}

/** All Newintel registrations (online or not) — used for the public roster. */
export function newintelRoster<T extends GridAgent>(all: readonly T[]): T[] {
  return all.filter((agent) => isNewintelAgent(agent));
}
