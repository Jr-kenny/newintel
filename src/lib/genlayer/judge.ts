/**
 * GenLayer **agent-settlement** client.
 *
 * Human/business path is untouched: they get the report from the
 * orchestrator. This only stores agent findings + final copy, then
 * adjudicates contribution weights for agent USDC payouts.
 *
 *   claim POST     → record_finding
 *   report ready   → record_final (matching input; business already served)
 *   before payout  → adjudicate + payout_ready
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ADDRESS =
  process.env["GENLAYER_JUDGE_ADDRESS"]?.trim() ||
  "0x81A1A3e254260154d7520f6De9D9c9eE95b5d86E";

const EXTRA_PATH =
  "/Users/user/.local/share/fnm/node-versions/v22.22.2/installation/bin:/Users/user/.bun/bin:/opt/homebrew/bin:/usr/local/bin";

function cliCandidates(): string[] {
  if (process.env["GENLAYER_CLI"]?.trim()) return [process.env["GENLAYER_CLI"]!.trim()];
  return [
    "/Users/user/.local/share/fnm/node-versions/v22.22.2/installation/bin/genlayer",
    "/Users/user/.local/bin/genlayer",
    "/opt/homebrew/bin/genlayer",
    "genlayer",
  ].filter((p, i, a) => a.indexOf(p) === i);
}

async function genlayer(args: string[], timeoutMs = 90_000): Promise<string | null> {
  for (const bin of cliCandidates()) {
    if (bin.includes("/") && !existsSync(bin)) continue;
    try {
      const { stdout, stderr } = await execFileAsync(bin, args, {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `${process.env["PATH"] ?? ""}:${EXTRA_PATH}`,
        },
      });
      return `${stdout}\n${stderr}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT")) continue;
      console.error("genlayer.cli failed:", bin, args[0], msg.slice(0, 240));
      return msg;
    }
  }
  console.error("genlayer.cli not found in", cliCandidates());
  return null;
}

function writeOk(out: string | null): boolean {
  return Boolean(out && /successfully|ACCEPTED|MAJORITY_AGREE/i.test(out));
}

export async function recordFinding(input: {
  inquiryId: string;
  agentId: string;
  observation: {
    company?: string | null;
    location?: string | null;
    contact?: string | null;
    event: string;
    sources: string[];
    observed: string;
  };
}): Promise<boolean> {
  const out = await genlayer([
    "write",
    ADDRESS,
    "record_finding",
    "--args",
    input.inquiryId,
    input.agentId,
    JSON.stringify(input.observation),
  ]);
  const ok = writeOk(out);
  if (!ok) console.error("record_finding failed:", out?.slice(0, 200));
  return ok;
}

export async function recordFinal(input: {
  inquiryId: string;
  finalIntelligence: Record<string, unknown>;
}): Promise<boolean> {
  const out = await genlayer([
    "write",
    ADDRESS,
    "record_final",
    "--args",
    input.inquiryId,
    JSON.stringify(input.finalIntelligence),
  ]);
  const ok = writeOk(out);
  if (!ok) console.error("record_final failed:", out?.slice(0, 200));
  return ok;
}

/**
 * Required for settlement. Calls adjudicate then reads get_verdict.
 * Weights are integer milli-shares (sum 1000) from the contract.
 */
export async function adjudicate(
  inquiryId: string,
): Promise<Record<string, number> | null> {
  const writeOut = await genlayer(
    ["write", ADDRESS, "adjudicate", "--args", inquiryId],
    90_000,
  );
  if (!writeOut || !writeOk(writeOut)) {
    console.error("adjudicate write failed:", writeOut?.slice(0, 240));
    return null;
  }
  // Always re-read the stored verdict — more reliable than parsing the write dump.
  const verdictOut = await genlayer(
    ["call", ADDRESS, "get_verdict", "--args", inquiryId],
    30_000,
  );
  return parseWeights(verdictOut);
}

function parseWeights(out: string | null): Record<string, number> | null {
  if (!out) return null;
  const weightRe = /"weights"\s*:\s*\{[^}]+\}/;
  const m = out.match(weightRe);
  if (m) {
    try {
      const data = JSON.parse(`{${m[0]}}`) as { weights: Record<string, number> };
      if (data.weights && Object.keys(data.weights).length > 0) return data.weights;
    } catch {}
  }
  try {
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const data = JSON.parse(out.slice(start, end + 1)) as {
        weights?: Record<string, number>;
        ready?: boolean;
      };
      if (data.weights && Object.keys(data.weights).length > 0) return data.weights;
    }
  } catch {}
  return null;
}

/** Milli-shares (sum 1000) → 0–1 floats for settlement math. */
export function milliToShares(
  milli: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (const v of Object.values(milli)) total += Number(v) || 0;
  if (total <= 0) return out;
  for (const [k, v] of Object.entries(milli)) {
    out[k] = (Number(v) || 0) / total;
  }
  return out;
}

export async function payoutReady(inquiryId: string): Promise<boolean> {
  const out = await genlayer(["call", ADDRESS, "payout_ready", "--args", inquiryId]);
  return Boolean(out && /\btrue\b/i.test(out));
}

/** Read last verdict JSON string from the contract. */
export async function getVerdict(inquiryId: string): Promise<string | null> {
  const out = await genlayer(["call", ADDRESS, "get_verdict", "--args", inquiryId]);
  return out;
}

export function judgeAddress(): string {
  return ADDRESS;
}
