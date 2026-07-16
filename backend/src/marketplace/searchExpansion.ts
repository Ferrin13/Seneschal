import { llmJson } from "../llm/index.js";
import type { Platform } from "./types.js";
import {
  buildCraigslistSearchUrl,
  craigslistConfigured,
} from "./craigslist/url.js";

/**
 * Structured constraints for a single Marketplace search. Stored on
 * `mp_searches.filters` and used to build the FB search URL.
 */
export type SearchFilters = {
  minPriceCents?: number;
  maxPriceCents?: number;
  category?: string;
  radiusMiles?: number;
  condition?: string[];
};

export type ExpandedSearch = {
  query: string;
  filters: SearchFilters;
  rationale?: string;
};

type LlmSearch = {
  query: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  category?: string | null;
  radiusMiles?: number | null;
  condition?: string[] | null;
  rationale?: string | null;
};

const SYSTEM = `You turn a shopper's natural-language target into a small set of concrete Facebook Marketplace search queries.
Rules:
- Return 1 to 5 searches that together cover the intent without excessive overlap.
- Each query should be short keywords a person would type into Marketplace search (no boolean operators).
- Only include a price bound if the target clearly implies one; prices are in whole dollars.
- Prefer specific product terms over broad ones when the target is specific.
Respond ONLY with JSON of the form:
{"searches":[{"query":"...","minPrice":null,"maxPrice":null,"category":null,"radiusMiles":null,"condition":null,"rationale":"..."}]}`;

/**
 * Expand a target into concrete searches via the LLM. Throws a 503-flavored
 * error if the LLM isn't configured. `userId`/`targetId` attribute the call's
 * cost; `model` optionally overrides the tier default for model comparison.
 */
export async function expandTarget(input: {
  userId: string;
  targetId: string;
  title: string;
  prompt: string;
  evalInstructions?: string | null;
  model?: string;
}): Promise<ExpandedSearch[]> {
  const user = [
    `Target title: ${input.title}`,
    `Target description: ${input.prompt}`,
    input.evalInstructions
      ? `Evaluation notes (may hint at constraints): ${input.evalInstructions}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await llmJson<{ searches?: LlmSearch[] }>({
    tier: "advanced",
    model: input.model,
    messages: [
      { role: "system", text: SYSTEM },
      { role: "user", text: user },
    ],
    maxTokens: 800,
    usage: {
      userId: input.userId,
      purpose: "search_expansion",
      targetId: input.targetId,
    },
  });

  const searches = Array.isArray(data.searches) ? data.searches : [];
  return searches
    .filter((s) => s && typeof s.query === "string" && s.query.trim())
    .slice(0, 5)
    .map((s) => {
      const filters: SearchFilters = {};
      if (typeof s.minPrice === "number") {
        filters.minPriceCents = Math.round(s.minPrice * 100);
      }
      if (typeof s.maxPrice === "number") {
        filters.maxPriceCents = Math.round(s.maxPrice * 100);
      }
      if (s.category) filters.category = s.category;
      if (typeof s.radiusMiles === "number") {
        filters.radiusMiles = s.radiusMiles;
      }
      if (Array.isArray(s.condition) && s.condition.length > 0) {
        filters.condition = s.condition;
      }
      return {
        query: s.query.trim(),
        filters,
        rationale: s.rationale ?? undefined,
      };
    });
}

/**
 * Build a ready-to-open Facebook Marketplace search URL. The user opens it,
 * confirms location, saves the search, and turns on email alerts. Newest-first
 * so alerts fire on fresh listings.
 */
export function buildFbSearchUrl(
  query: string,
  filters: SearchFilters | null | undefined
): string {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("sortBy", "creation_time_descend");
  params.set("daysSinceListed", "1");
  if (filters?.minPriceCents != null) {
    params.set("minPrice", String(Math.round(filters.minPriceCents / 100)));
  }
  if (filters?.maxPriceCents != null) {
    params.set("maxPrice", String(Math.round(filters.maxPriceCents / 100)));
  }
  return `https://www.facebook.com/marketplace/search/?${params.toString()}`;
}

/** A concrete search to persist: one platform + its ready-to-open URL. */
export type PlatformSearch = {
  platform: Platform;
  query: string;
  filters: SearchFilters;
  searchUrl: string;
  rationale?: string;
};

/**
 * Fan an LLM query set out into per-platform searches. Facebook is always
 * included; Craigslist is added when a region slug is configured. Both
 * platforms reuse the same query + filters so results stay comparable.
 */
export function toPlatformSearches(
  expanded: ExpandedSearch[]
): PlatformSearch[] {
  const out: PlatformSearch[] = [];
  for (const e of expanded) {
    out.push({
      platform: "facebook",
      query: e.query,
      filters: e.filters,
      searchUrl: buildFbSearchUrl(e.query, e.filters),
      rationale: e.rationale,
    });
    if (craigslistConfigured()) {
      const url = buildCraigslistSearchUrl(e.query, e.filters);
      if (url) {
        out.push({
          platform: "craigslist",
          query: e.query,
          filters: e.filters,
          searchUrl: url,
          rationale: e.rationale,
        });
      }
    }
  }
  return out;
}
