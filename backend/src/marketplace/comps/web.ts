import { llmConfigured, llmJson } from "../../llm/index.js";
import type { LlmUsageContext } from "../../llm/index.js";
import type { RawComp } from "./ebay.js";

/**
 * Gather price comparables via an internet search, using OpenRouter's
 * `openrouter:web_search` server tool (the model decides when to search and
 * OpenRouter runs it server-side, returning grounded, cited results). Returns
 * normalized comps; token/cost is logged via the usage context.
 */

const SYSTEM = `You are a resale-pricing researcher. Given an item, search the web for what comparable items currently sell for (marketplaces, retail, recent sold/asking prices). Prefer same or very similar make/model/condition.
Return ONLY JSON:
{"comps":[{"title":"...","priceCents":integer,"currency":"USD","url":"source url","note":"e.g. sold/asking/retail"}],"estimatedValueCents":integer|null,"summary":"one sentence"}
Rules:
- priceCents is the price in cents (e.g. $450.00 -> 45000).
- Include 3-8 of the most relevant comps; omit anything you cannot price.
- Use real source URLs you actually found.`;

type WebComp = {
  title?: string;
  priceCents?: number;
  currency?: string;
  url?: string;
  note?: string;
};

type WebCompsResult = {
  comps?: WebComp[];
  estimatedValueCents?: number | null;
  summary?: string;
};

export function webCompsConfigured(): boolean {
  return llmConfigured();
}

export async function webComps(
  query: string,
  opts: { model?: string; usage: LlmUsageContext; maxResults?: number }
): Promise<{ comps: RawComp[]; estimatedValueCents: number | null; summary: string | null }> {
  const { data } = await llmJson<WebCompsResult>({
    tier: "advanced",
    model: opts.model,
    // Web search is incompatible with JSON response-format mode on some
    // providers ("Web Search cannot be used with JSON mode"), so we disable
    // JSON mode and rely on the prompt + defensive parsing instead.
    jsonMode: false,
    tools: [
      {
        type: "openrouter:web_search",
        parameters: { engine: "auto", max_total_results: opts.maxResults ?? 10 },
      },
    ],
    // This is a structured-extraction task, not a reasoning one. Turning
    // reasoning off stops thinking tokens from consuming the completion budget
    // (which was truncating the JSON mid-array and breaking parsing), and keeps
    // cost down on reasoning-capable models.
    reasoning: { enabled: false },
    messages: [
      { role: "system", text: SYSTEM },
      { role: "user", text: `Item: ${query}` },
    ],
    // Generous cap: several comps with long marketplace URLs plus a summary can
    // run past 1k tokens; too small truncates the JSON and fails the parse.
    maxTokens: 4000,
    usage: opts.usage,
  });

  const raw = Array.isArray(data.comps) ? data.comps : [];
  const comps: RawComp[] = raw
    .filter((c) => c && typeof c.priceCents === "number")
    .map((c) => ({
      matchedTitle: c.title ?? null,
      priceCents:
        typeof c.priceCents === "number" ? Math.round(c.priceCents) : null,
      currency: c.currency ?? "USD",
      url: c.url ?? null,
      soldAt: null,
      raw: c as Record<string, unknown>,
    }));

  return {
    comps,
    estimatedValueCents:
      typeof data.estimatedValueCents === "number"
        ? Math.round(data.estimatedValueCents)
        : null,
    summary: data.summary ?? null,
  };
}
