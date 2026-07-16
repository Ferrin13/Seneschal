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

/** Build a same-site Craigslist search URL used as a dead-link fallback. */
function craigslistSearchFallback(hostname: string, query: string | null | undefined): string {
  const q = (query ?? "").trim();
  const search = new URL(`https://${hostname}/search/sss`);
  if (q) search.searchParams.set("query", q);
  search.searchParams.set("sort", "date");
  return search.toString();
}

/**
 * Text Craigslist renders (with a 200 status) for postings that are gone. We
 * treat these as dead even though the HTTP request "succeeds".
 */
const CRAIGSLIST_DEAD_MARKERS = [
  "this posting has expired",
  "this posting has been deleted",
  "this posting has been flagged for removal",
];

/**
 * Check whether a Craigslist listing permalink resolves to a live posting.
 * Craigslist returns 404 for unknown ids and a 200 "This posting has expired /
 * been deleted" page for stale ones, so we inspect both status and body.
 * Any network/parse failure is treated as not-live (caller falls back).
 */
async function craigslistListingIsLive(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: CRAIGSLIST_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const html = (await res.text()).toLowerCase();
    return !CRAIGSLIST_DEAD_MARKERS.some((m) => html.includes(m));
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Craigslist listing deep-links are ephemeral: postings expire (typically
 * within ~30 days) and the numeric posting id can't be reconstructed. LLM
 * ("web") comps in particular routinely cite plausible-looking but dead URLs —
 * correct host/format, hallucinated id + slug (e.g. a "hot tub" comp linking to
 * `.../yountville-compact-hot-tub/7924550056.html`, which 404s).
 *
 * We keep the specific-item link when it actually resolves to a live posting,
 * and only rewrite to a same-site search for `query` when the deep-link is dead
 * (404 or an expired/deleted page), so users land on the real item whenever
 * possible instead of always being bounced to a search.
 *
 * Only touches per-listing permalinks that end in `/<digits>.html` (the pattern
 * that goes stale/is hallucinated). Non-Craigslist URLs, search URLs, and the
 * stable `www.craigslist.org/view/d/<slug>/<token>` permalinks are returned
 * unchanged.
 */
export async function repairCraigslistCompUrl(
  url: string | null | undefined,
  query: string | null | undefined
): Promise<string | null> {
  if (!url) return url ?? null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const isCraigslist = /(^|\.)craigslist\.org$/i.test(parsed.hostname);
  const isListingPermalink = /\/\d+\.html$/i.test(parsed.pathname);
  if (!isCraigslist || !isListingPermalink) return url;
  if (await craigslistListingIsLive(url)) return url;
  return craigslistSearchFallback(parsed.hostname, query);
}
