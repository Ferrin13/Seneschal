import { llmConfigured, llmJson } from "../../llm/index.js";
import type { LlmUsageContext } from "../../llm/index.js";
import { repairCraigslistCompUrl } from "../craigslist/url.js";
import type { RawComp } from "./ebay.js";

/** Whether to research used/secondhand resale prices or brand-new/retail. */
export type CompCondition = "new" | "used";

/**
 * Gather price comparables via an internet search, using OpenRouter's
 * `openrouter:web_search` server tool (the model decides when to search and
 * OpenRouter runs it server-side, returning grounded, cited results). Returns
 * normalized comps; token/cost is logged via the usage context.
 */

function buildSystem(region: string, condition: CompCondition): string {
  const conditionRules =
    condition === "used"
      ? `You are researching USED / secondhand RESALE prices only.
- Focus on used-item marketplaces and recent sold/asking prices for pre-owned units: eBay sold "used" listings, Facebook Marketplace, Craigslist, OfferUp, Nextdoor, local classifieds.
- EXCLUDE brand-new, sealed, or retail/MSRP prices — those are gathered separately.
- In "note", say the condition and whether the price is sold or asking (e.g. "used - sold", "used - asking").`
      : `You are researching BRAND-NEW / retail prices only.
- Focus on the current new/retail price for this item: manufacturer/retailer pages, MSRP, Amazon/Walmart/Best Buy new listings, eBay "brand new" listings.
- EXCLUDE used/secondhand/refurbished prices — those are gathered separately.
- In "note", say the price is retail/new and name the seller (e.g. "new - retail MSRP", "new - Amazon").`;
  return `You are a resale-pricing researcher. Given an item, search the web for what comparable items currently sell for. Prefer the same or a very similar make/model.
${conditionRules}
Return ONLY JSON:
{"comps":[{"title":"...","priceCents":integer,"currency":"USD","url":"source url","note":"see below"}],"estimatedValueCents":integer|null,"summary":"one sentence"}
Rules:
- priceCents is the price in cents (e.g. $450.00 -> 45000).
- estimatedValueCents is your best single estimate of the ${
    condition === "used" ? "typical used resale" : "brand-new/retail"
  } price.
- Include 3-8 of the most relevant comps; omit anything you cannot price.
- Use real source URLs you actually found.
- LOCATION: This item is being resold in ${region}. For local, in-person marketplaces (Facebook Marketplace, Craigslist, OfferUp, Nextdoor, local classifieds), ONLY include listings located in or near that area — exclude out-of-area local listings, as prices and demand differ by region.
- Nationwide online sources where location doesn't affect price (eBay sold/asking, Amazon, retailer/MSRP pages, shippable marketplaces) are fine regardless of location; label them accordingly in "note".
- Prefer local comps; use nationwide online prices mainly to fill gaps when local data is sparse.`;
}

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
  opts: {
    model?: string;
    usage: LlmUsageContext;
    maxResults?: number;
    region: string;
    condition: CompCondition;
  }
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
      { role: "system", text: buildSystem(opts.region, opts.condition) },
      {
        role: "user",
        text: `Item: ${query}\nResale location: ${opts.region}\nResearch ${opts.condition} prices.`,
      },
    ],
    // Generous cap: several comps with long marketplace URLs plus a summary can
    // run past 1k tokens; too small truncates the JSON and fails the parse.
    maxTokens: 4000,
    usage: opts.usage,
  });

  const raw = Array.isArray(data.comps) ? data.comps : [];
  const comps: RawComp[] = await Promise.all(
    raw
      .filter((c) => c && typeof c.priceCents === "number")
      .map(async (c) => ({
        matchedTitle: c.title ?? null,
        priceCents:
          typeof c.priceCents === "number" ? Math.round(c.priceCents) : null,
        currency: c.currency ?? "USD",
        // LLM-cited Craigslist listing URLs are frequently hallucinated/expired
        // and 404. Keep the deep-link when it actually resolves; otherwise fall
        // back to a same-site search. (Original stays in `raw`.)
        url: await repairCraigslistCompUrl(c.url ?? null, c.title ?? null),
        soldAt: null,
        raw: c as Record<string, unknown>,
      }))
  );

  return {
    comps,
    estimatedValueCents:
      typeof data.estimatedValueCents === "number"
        ? Math.round(data.estimatedValueCents)
        : null,
    summary: data.summary ?? null,
  };
}
