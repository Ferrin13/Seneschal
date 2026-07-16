import * as cheerio from "cheerio";
import { config } from "../../config.js";
import type { RawComp } from "./ebay.js";

/**
 * Craigslist has no official API and, as of 2025, actively 403s the old
 * `?format=rss` search feed. What still works for anonymous clients is the
 * no-JS fallback baked into the HTML search page: a `<ol>` of
 * `<li class="cl-static-search-result">` items rendered for crawlers/no-JS
 * browsers. We fetch that page (with a real browser UA — a bot UA gets
 * blocked) and parse those static items. Enabled only when CRAIGSLIST_SITE
 * is set to the region slug (e.g. "boise", "seattle", "sfbay").
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export function craigslistConfigured(): boolean {
  return !!config.CRAIGSLIST_SITE;
}

function parsePriceCents(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/[$]\s?(\d[\d,]*(?:\.\d{2})?)/);
  if (!m) return null;
  const v = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

/** Fetch and parse the Craigslist HTML search page for `query`. */
export async function craigslistComps(
  query: string,
  limit = 15
): Promise<RawComp[]> {
  if (!config.CRAIGSLIST_SITE) return [];
  const url = new URL(
    `https://${config.CRAIGSLIST_SITE}.craigslist.org/search/sss`
  );
  url.searchParams.set("query", query);

  const res = await fetch(url, {
    headers: {
      "user-agent": BROWSER_UA,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`craigslist_error ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = $("li.cl-static-search-result").toArray().slice(0, limit);
  return items.map((el) => {
    const li = $(el);
    const title =
      (li.attr("title") || li.find(".title").first().text() || "").trim() ||
      null;
    const href = li.find("a").first().attr("href") || null;
    const priceText = li.find(".price").first().text().trim();
    return {
      matchedTitle: title,
      priceCents: parsePriceCents(priceText),
      currency: "USD",
      url: href,
      soldAt: null,
      raw: { title, url: href, price: priceText },
    };
  });
}
