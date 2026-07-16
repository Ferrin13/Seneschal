import * as cheerio from "cheerio";
import type { HarvestedItem } from "../types.js";
import { CRAIGSLIST_HEADERS } from "./url.js";

function parsePriceCents(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/[$]\s?(\d[\d,]*(?:\.\d{2})?)/);
  if (!m) return null;
  const v = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

/**
 * Stable id for a Craigslist result. Numeric posting URLs end in `<id>.html`;
 * the no-JS `/view/d/<slug>/<token>` links carry an opaque token as the last
 * path segment. Either is stable enough to dedupe on.
 */
export function craigslistExternalId(url: string): string | null {
  const numeric = url.match(/\/(\d+)\.html(?:$|[?#])/);
  if (numeric) return numeric[1]!;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const last = path.split("/").pop();
    return last || null;
  } catch {
    return null;
  }
}

/**
 * Fetch and parse a Craigslist HTML search page into listing tiles. Uses the
 * no-JS static result list (`li.cl-static-search-result`) that Craigslist
 * bakes into the page for crawlers — a pure load-and-parse, no browser.
 */
export async function craigslistSearch(
  searchUrl: string,
  limit = 40
): Promise<HarvestedItem[]> {
  const res = await fetch(searchUrl, { headers: CRAIGSLIST_HEADERS });
  if (!res.ok) {
    throw new Error(`craigslist_search_error ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = $("li.cl-static-search-result").toArray().slice(0, limit);
  return items.map((el) => {
    const li = $(el);
    const title =
      (li.attr("title") || li.find(".title").first().text() || "").trim() ||
      null;
    const url = li.find("a").first().attr("href") || searchUrl;
    const priceText = li.find(".price").first().text().trim();
    return {
      platform: "craigslist" as const,
      externalId: craigslistExternalId(url),
      url,
      title,
      priceCents: parsePriceCents(priceText),
      thumbnailUrl: null,
    };
  });
}
