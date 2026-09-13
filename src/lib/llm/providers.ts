/**
 * Provider order for every LLM pass in the orchestrator.
 *
 * 0G Compute Router leads (gpt-5.6-luna; fallback glm-5.3-flash).
 * OpenRouter is the free-model fallback only — that key has no credits.
 * OpenCode Zen is retired — it does not work.
 */

import { chatJson } from "@/lib/0g/compute-router";
import { chatJsonOpenRouter, openRouterConfig } from "@/lib/llm/openrouter";

export type JsonCaller = (opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) => Promise<{ content: string }>;

export type ProviderOption = { fn: JsonCaller; name: string };

/**
 * 0G first when a key is configured, then free OpenRouter models.
 * Zen is gone.
 */
export function jsonProviders(): ProviderOption[] {
  const order: ProviderOption[] = [];
  order.push({ fn: chatJson, name: "0G" });
  if (openRouterConfig().live) {
    order.push({ fn: chatJsonOpenRouter, name: `openrouter:${openRouterConfig().model}` });
  }
  return order;
}

/** For the status surfaces: which provider leads and what the chain looks like. */
export function providerChain(): { primary: string; chain: string[] } {
  const chain = jsonProviders().map((p) => p.name);
  return { primary: chain[0] ?? "none", chain };
}
