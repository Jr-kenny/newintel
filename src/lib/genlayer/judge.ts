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
 *
 * Bradbury writes flake under load. Every write retries with backoff
 * and only counts as success on ACCEPTED / FINISHED_WITH_RETURN /
 * "successfully executed". Reads after a write wait briefly so the
 * verdict map is visible.
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

const WRITE_TIMEOUT_MS = 120_000;
const READ_TIMEOUT_MS = 45_000;
const DEFAULT_WRITE_ATTEMPTS = 3;
const READ_AFTER_WRITE_MS = 1_500;

function cliCandidates(): string[] {
  if (process.env["GENLAYER_CLI"]?.trim()) return [process.env["GENLAYER_CLI"]!.trim()];
  return [
    "/Users/user/.local/share/fnm/node-versions/v22.22.2/installation/bin/genlayer",
    "/Users/user/.local/bin/genlayer",
    "/opt/homebrew/bin/genlayer",
    "genlayer",
  ].filter((p, i, a) => a.indexOf(p) === i);
}

async function genlayer(args: string[], timeoutMs = READ_TIMEOUT_MS): Promise<string | null> {
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
      // Include partial stdout/stderr when the CLI timed out or exited non-zero.
      const extra =
        err && typeof err === "object"
          ? [
              "stdout" in err && typeof err.stdout === "string" ? err.stdout : "",
              "stderr" in err && typeof err.stderr === "string" ? err.stderr : "",
            ].join("\n")
          : "";
      return `${msg}\n${extra}`;
    }
  }
  console.error("genlayer.cli not found in", cliCandidates());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Bradbury success = consensus ACCEPTED and execution FINISHED_WITH_RETURN (or CLI ok). */
function writeOk(out: string | null): boolean {
  if (!out) return false;
  if (/FATAL|reverted|INVALID|insufficient funds|timeout of \d+ms exceeded/i.test(out)) {
    // Still allow success markers that coexist with noisy stderr.
    if (!/successfully executed|status_name:\s*['"]?ACCEPTED|FINISHED_WITH_RETURN/i.test(out)) {
      return false;
    }
  }
  return /successfully executed|status_name:\s*['"]?ACCEPTED|FINISHED_WITH_RETURN|MAJORITY_AGREE/i.test(
    out,
  );
}

async function writeWithRetry(
  method: string,
  args: string[],
  attempts = DEFAULT_WRITE_ATTEMPTS,
): Promise<{ ok: boolean; out: string | null; tries: number }> {
  let last: string | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const out = await genlayer(
      ["write", ADDRESS, method, "--args", ...args],
      WRITE_TIMEOUT_MS,
    );
    last = out;
    if (writeOk(out)) return { ok: true, out, tries: attempt };
    console.error(
      `genlayer.write ${method} attempt ${attempt}/${attempts} failed:`,
      out?.slice(0, 220),
    );
    if (attempt < attempts) await sleep(2_000 * attempt);
  }
  return { ok: false, out: last, tries: attempts };
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
    /** Sibyl reliability ledger — scored by the judge. */
    verified_recalls?: number;
    discoveries?: number;
  };
}): Promise<boolean> {
  const { ok } = await writeWithRetry("record_finding", [
    input.inquiryId,
    input.agentId,
    JSON.stringify(input.observation),
  ]);
  return ok;
}

export async function recordFinal(input: {
  inquiryId: string;
  finalIntelligence: Record<string, unknown> | string;
}): Promise<boolean> {
  const payload =
    typeof input.finalIntelligence === "string"
      ? input.finalIntelligence
      : JSON.stringify(input.finalIntelligence);
  const { ok } = await writeWithRetry("record_final", [input.inquiryId, payload]);
  return ok;
}

/**
 * Required for settlement. Calls adjudicate then reads get_verdict.
 * Weights are integer milli-shares (sum 1000) from the contract.
 */
export async function adjudicate(
  inquiryId: string,
): Promise<Record<string, number> | null> {
  const write = await writeWithRetry("adjudicate", [inquiryId], 3);
  if (!write.ok) {
    console.error("adjudicate write failed:", write.out?.slice(0, 240));
    return null;
  }
  await sleep(READ_AFTER_WRITE_MS);
  // Always re-read the stored verdict — more reliable than parsing the write dump.
  const verdictOut = await genlayer(
    ["call", ADDRESS, "get_verdict", "--args", inquiryId],
    READ_TIMEOUT_MS,
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
  const out = await genlayer(["call", ADDRESS, "payout_ready", "--args", inquiryId], READ_TIMEOUT_MS);
  return Boolean(out && /\btrue\b/i.test(out));
}

/** Read last verdict JSON string from the contract. */
export async function getVerdict(inquiryId: string): Promise<string | null> {
  const out = await genlayer(["call", ADDRESS, "get_verdict", "--args", inquiryId], READ_TIMEOUT_MS);
  return out;
}

/** Hard gate used by settlement: chain weights + payout_ready. */
export async function settlementGate(
  inquiryId: string,
): Promise<{ milli: Record<string, number> | null; ready: boolean }> {
  const milli = await adjudicate(inquiryId);
  const ready = await payoutReady(inquiryId);
  return { milli, ready };
}

/** Point the IC at the Base payout relayer (web-oracle hook). */
export async function setPayoutHook(url: string): Promise<boolean> {
  const { ok } = await writeWithRetry("set_payout_hook", [url], 2);
  return ok;
}

/**
 * Ask the IC to POST the ready verdict to the payout relayer under
 * consensus. This is the GenLayer → Base inter-comms path.
 */
export async function requestPayout(inquiryId: string): Promise<string | null> {
  const write = await writeWithRetry("request_payout", [inquiryId], 2);
  return write.out;
}

export function judgeAddress(): string {
  return ADDRESS;
}
