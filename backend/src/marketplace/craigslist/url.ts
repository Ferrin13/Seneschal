import { config } from "../../config.js";
import type { SearchFilters } from "../searchExpansion.js";

/** Realistic browser UA — Craigslist 403s obvious bot agents. */
export const CRAIGSLIST_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export const CRAIGSLIST_HEADERS: Record<string, string> = {
  "user-agent": CRAIGSLIST_UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

export function craigslistConfigured(): boolean {
  return !!config.CRAIGSLIST_SITE;
}

/**
 * Build a Craigslist HTML search URL for the configured region. Newest-first
 * (`sort=date`) so hunts surface fresh listings. Returns null if no site slug
 * is configured.
 */
export function buildCraigslistSearchUrl(
  query: string,
  filters?: SearchFilters | null
): string | null {
  const site = config.CRAIGSLIST_SITE;
  if (!site) return null;
  const url = new URL(`https://${site}.craigslist.org/search/sss`);
  url.searchParams.set("query", query);
  url.searchParams.set("sort", "date");
  if (filters?.minPriceCents != null) {
    url.searchParams.set(
      "min_price",
      String(Math.round(filters.minPriceCents / 100))
    );
  }
  if (filters?.maxPriceCents != null) {
    url.searchParams.set(
      "max_price",
      String(Math.round(filters.maxPriceCents / 100))
    );
  }
  return url.toString();
}
