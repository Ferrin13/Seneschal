import * as cheerio from "cheerio";
import type { DeepListing } from "../types.js";
import { CRAIGSLIST_HEADERS } from "./url.js";
import { craigslistExternalId } from "./search.js";

function priceCentsFrom(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/[$]?\s?(\d[\d,]*(?:\.\d{2})?)/);
  if (!m) return null;
  const v = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

function isoOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type LdProduct = {
  name?: string;
  description?: string;
  image?: string | string[];
  offers?: { price?: string | number; priceCurrency?: string };
};

/**
 * Fetch and parse a Craigslist posting (PDP). Pure server-side fetch (no login
 * required). Prefers the embedded JSON-LD Product block, falling back to the
 * DOM. Extracts posted/updated times so the pipeline can track listing age.
 */
export async function craigslistListing(url: string): Promise<DeepListing> {
  const res = await fetch(url, {
    headers: CRAIGSLIST_HEADERS,
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`craigslist_listing_error ${res.status}`);
  }
  const finalUrl = res.url || url;
  const html = await res.text();
  const $ = cheerio.load(html);

  // Removed/expired postings show a "This posting has been deleted/expired"
  // banner and no product block.
  const removed = $(".removed, .post-expired-note").length > 0;

  let ld: LdProduct | null = null;
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(el).text()) as
        | (LdProduct & { "@type"?: string })
        | (LdProduct & { "@type"?: string })[];
      const node = Array.isArray(parsed) ? parsed[0] : parsed;
      if (node && (node["@type"] === "Product" || node.offers || node.image)) {
        ld = node;
        break;
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  const title =
    $("#titletextonly").first().text().trim() ||
    (ld?.name ?? null) ||
    ($('meta[property="og:title"]').attr("content") ?? null) ||
    null;

  const priceText = $(".price").first().text().trim();
  const priceCents =
    priceCentsFrom(priceText) ??
    (ld?.offers?.price != null ? priceCentsFrom(String(ld.offers.price)) : null);

  // Description: strip the leading "QR Code Link to This Post" helper block.
  const bodyEl = $("#postingbody").clone();
  bodyEl.find(".print-information, .print-qrcode-container").remove();
  const description =
    bodyEl.text().replace(/\s+/g, " ").trim() ||
    (ld?.description ?? null) ||
    null;

  // Condition + other attributes.
  let conditionLabel: string | null = null;
  $(".attrgroup .attr, p.attrgroup span").each((_, el) => {
    const t = $(el).text().trim().toLowerCase();
    const m = t.match(/condition:\s*(.+)/);
    if (m) conditionLabel = m[1]!.trim();
  });

  // Location: prefer the map's lat/lng, then the title's parenthetical.
  const map = $("#map").first();
  const latitude = map.attr("data-latitude")
    ? Number(map.attr("data-latitude"))
    : null;
  const longitude = map.attr("data-longitude")
    ? Number(map.attr("data-longitude"))
    : null;
  const rawLocation =
    $(".postingtitletext small").first().text().replace(/[()]/g, "").trim() ||
    $(".mapaddress").first().text().trim() ||
    "";
  // Ignore the map link ("google map") that sometimes matches these selectors.
  const locationText =
    rawLocation && !/^google\s*map$/i.test(rawLocation) ? rawLocation : null;

  // Posted / updated times from the postinginfos block.
  let listedAt: string | null = null;
  let sourceUpdatedAt: string | null = null;
  $(".postinginfo.reveal, .postinginfos .postinginfo").each((_, el) => {
    const label = $(el).text().toLowerCase();
    const dt = $(el).find("time").attr("datetime");
    if (!dt) return;
    if (label.includes("updated")) sourceUpdatedAt = isoOrNull(dt);
    else if (label.includes("posted") && !listedAt) listedAt = isoOrNull(dt);
  });
  if (!listedAt) {
    listedAt = isoOrNull($("time.date.timeago").first().attr("datetime"));
  }

  // Images: JSON-LD image array first, then gallery/og fallbacks.
  const imageUrls = new Set<string>();
  if (ld?.image) {
    const arr = Array.isArray(ld.image) ? ld.image : [ld.image];
    for (const u of arr) if (u) imageUrls.add(u);
  }
  const og = $('meta[property="og:image"]').attr("content");
  if (og) imageUrls.add(og);
  $(".gallery img, figure img, .slide img").each((_, el) => {
    const src = $(el).attr("src");
    if (src && src.startsWith("http")) imageUrls.add(src);
  });
  const images = [...imageUrls].map((sourceUrl) => ({ sourceUrl }));

  const hasContent = !!(title || priceCents != null || description);

  return {
    platform: "craigslist",
    externalId: craigslistExternalId(finalUrl),
    url: finalUrl,
    title,
    description,
    priceCents,
    currency: ld?.offers?.priceCurrency ?? (priceCents != null ? "USD" : null),
    conditionLabel,
    locationText,
    latitude: latitude != null && Number.isFinite(latitude) ? latitude : null,
    longitude:
      longitude != null && Number.isFinite(longitude) ? longitude : null,
    sellerName: null,
    isSold: removed ? true : null,
    listedAt,
    sourceUpdatedAt,
    images,
    rawExtract: (ld as Record<string, unknown> | null) ?? null,
    scrapeStatus: removed ? "partial" : hasContent ? "ok" : "partial",
  };
}
