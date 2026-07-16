import type { Page } from "playwright";

/**
 * Facebook Marketplace listing extraction from the page's embedded Relay JSON
 * (the <script type="application/json"> blobs), ported from the scraper POC.
 * Far more reliable than DOM scraping.
 */

type Json = Record<string, unknown>;

export type ScrapedImage = {
  id: string | null;
  sourceUrl: string;
  width: number | null;
  height: number | null;
  caption: string | null;
};

export type ScrapedListing = {
  fbItemId: string | null;
  url: string;
  title: string | null;
  description: string | null;
  priceCents: number | null;
  currency: string | null;
  conditionCode: string | null;
  conditionLabel: string | null;
  categoryId: string | null;
  categoryPath: string[];
  locationText: string | null;
  latitude: number | null;
  longitude: number | null;
  sellerId: string | null;
  sellerName: string | null;
  sellerProfileUrl: string | null;
  sellerRatingAverage: number | null;
  sellerRatingCount: number | null;
  availabilityStatus: string | null;
  isSold: boolean | null;
  isPending: boolean | null;
  listedAt: string | null;
  images: ScrapedImage[];
  rawExtract: Json | null;
  scrapeStatus: "ok" | "partial" | "failed";
};

export function parseItemId(url: string): string | null {
  const m = url.match(/\/marketplace\/item\/(\d+)/);
  return m ? m[1]! : null;
}

function collectByKey(root: unknown, key: string, acc: Json[] = []): Json[] {
  if (root === null || typeof root !== "object") return acc;
  if (Array.isArray(root)) {
    for (const v of root) collectByKey(v, key, acc);
    return acc;
  }
  const obj = root as Json;
  if (key in obj) acc.push(obj);
  for (const v of Object.values(obj)) collectByKey(v, key, acc);
  return acc;
}

function richestByKey(blobs: unknown[], key: string): Json | null {
  let best: Json | null = null;
  for (const b of blobs) {
    for (const obj of collectByKey(b, key)) {
      if (!best || Object.keys(obj).length > Object.keys(best).length) {
        best = obj;
      }
    }
  }
  return best;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function get(obj: Json | null, path: string): unknown {
  if (!obj) return undefined;
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && !Array.isArray(acc)) {
      return (acc as Json)[k];
    }
    return undefined;
  }, obj);
}

function buildListing(
  blobs: unknown[],
  url: string,
  fbItemId: string | null
): ScrapedListing | null {
  const detail =
    richestByKey(blobs, "redacted_description") ??
    richestByKey(blobs, "marketplace_listing_title");
  const photosNode = richestByKey(blobs, "listing_photos");
  const seoNode = richestByKey(blobs, "seo_virtual_category");

  if (!detail) return null;

  const priceAmount = str(get(detail, "listing_price.amount"));
  const priceOffset = str(
    get(detail, "listing_price.amount_with_offset_in_currency")
  );
  const priceCents =
    priceOffset && /^\d+$/.test(priceOffset)
      ? Number(priceOffset)
      : priceAmount
        ? Math.round(Number(priceAmount) * 100)
        : null;

  let conditionLabel: string | null = null;
  const attrs = get(detail, "attribute_data");
  if (Array.isArray(attrs)) {
    const cond = attrs.find(
      (a) => (a as Json)?.attribute_name === "Condition"
    ) as Json | undefined;
    conditionLabel = str(cond?.label);
  }

  const seller = get(detail, "marketplace_listing_seller") as Json | undefined;
  const sellerId = str(seller?.id) ?? str(seller?.user_id);

  const taxonomy = get(seoNode, "seo_virtual_category.taxonomy_path");
  const categoryPath = Array.isArray(taxonomy)
    ? taxonomy
        .map((t) => str(get(t as Json, "seo_info.seo_url")))
        .filter((s): s is string => !!s)
    : [];

  const photos = get(photosNode, "listing_photos");
  const images: ScrapedImage[] = Array.isArray(photos)
    ? photos
        .map((p) => {
          const img = (p as Json)?.image as Json | undefined;
          return {
            id: str((p as Json)?.id),
            sourceUrl: str(img?.uri) ?? "",
            width: num(img?.width),
            height: num(img?.height),
            caption: str((p as Json)?.accessibility_caption),
          };
        })
        .filter((p) => p.sourceUrl)
    : [];

  const creationTime = num(get(detail, "creation_time"));

  return {
    fbItemId: fbItemId ?? str(detail.id),
    url,
    title:
      str(get(detail, "marketplace_listing_title")) ??
      str(get(detail, "base_marketplace_listing_title")),
    description: str(get(detail, "redacted_description.text")),
    priceCents,
    currency: str(get(detail, "listing_price.currency")),
    conditionCode: str(get(detail, "condition")),
    conditionLabel,
    categoryId: str(get(detail, "marketplace_listing_category_id")),
    categoryPath,
    locationText: str(get(detail, "location_text.text")),
    latitude: num(get(detail, "location.latitude")),
    longitude: num(get(detail, "location.longitude")),
    sellerId,
    sellerName: str(seller?.name),
    sellerProfileUrl: sellerId
      ? `https://www.facebook.com/${sellerId}`
      : null,
    sellerRatingAverage: num(
      get(
        seller ?? null,
        "marketplace_ratings_stats_by_role_v2.seller_stats.five_star_ratings_average"
      )
    ),
    sellerRatingCount: num(
      get(
        seller ?? null,
        "marketplace_ratings_stats_by_role_v2.seller_stats.five_star_total_rating_count_by_role"
      )
    ),
    availabilityStatus: str(get(detail, "renderable_listing_status")),
    isSold: get(detail, "is_sold") === true,
    isPending: get(detail, "is_pending") === true,
    listedAt: creationTime
      ? new Date(creationTime * 1000).toISOString()
      : null,
    images,
    rawExtract: detail,
    scrapeStatus: "ok",
  };
}

/**
 * Navigate to a listing and extract it. Returns the structured listing plus
 * the full page HTML (for archival). Throws if the page indicates a logged-out
 * state so the caller can flag `needs_login`.
 */
export async function scrapeListing(
  page: Page,
  url: string
): Promise<{ listing: ScrapedListing; html: string }> {
  const fbItemId = parseItemId(url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await page
    .waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll('script[type="application/json"]')
        ).some((s) =>
          (s.textContent ?? "").includes("marketplace_listing_title")
        ),
      { timeout: 20_000 }
    )
    .catch(() => undefined);

  const blobText: string[] = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('script[type="application/json"]')
    ).map((s) => s.textContent ?? "")
  );

  const blobs: unknown[] = [];
  for (const t of blobText) {
    try {
      blobs.push(JSON.parse(t));
    } catch {
      /* not all blobs are standalone JSON */
    }
  }

  const html = await page.content();
  const listing = buildListing(blobs, url, fbItemId);

  if (!listing) {
    // Distinguish logged-out from a genuinely empty listing.
    const loggedOut = /log in|you must log in/i.test(
      await page.title().catch(() => "")
    );
    if (loggedOut) {
      const err = new Error("logged_out") as Error & { loggedOut: boolean };
      err.loggedOut = true;
      throw err;
    }
    return {
      listing: emptyListing(url, fbItemId),
      html,
    };
  }

  return { listing, html };
}

function emptyListing(url: string, fbItemId: string | null): ScrapedListing {
  return {
    fbItemId,
    url,
    title: null,
    description: null,
    priceCents: null,
    currency: null,
    conditionCode: null,
    conditionLabel: null,
    categoryId: null,
    categoryPath: [],
    locationText: null,
    latitude: null,
    longitude: null,
    sellerId: null,
    sellerName: null,
    sellerProfileUrl: null,
    sellerRatingAverage: null,
    sellerRatingCount: null,
    availabilityStatus: null,
    isSold: null,
    isPending: null,
    listedAt: null,
    images: [],
    rawExtract: null,
    scrapeStatus: "partial",
  };
}

export type SearchResultItem = {
  fbItemId: string | null;
  url: string;
  title: string | null;
  priceCents: number | null;
  thumbnailUrl: string | null;
};

function summaryPriceCents(node: Json): number | null {
  const offset = str(get(node, "listing_price.amount_with_offset_in_currency"));
  if (offset && /^\d+$/.test(offset)) return Number(offset);
  const amount = str(get(node, "listing_price.amount"));
  if (amount && /^\d+(\.\d+)?$/.test(amount)) {
    return Math.round(Number(amount) * 100);
  }
  return null;
}

function summaryThumb(node: Json): string | null {
  return (
    str(get(node, "primary_listing_photo.image.uri")) ??
    str(get(node, "primary_listing_photo.listing_image.uri")) ??
    null
  );
}

/**
 * Extract all listing tiles from a Marketplace search results page. Reuses the
 * embedded-JSON approach: every node carrying `marketplace_listing_title` is a
 * listing summary, deduped by id.
 */
export async function scrapeSearch(
  page: Page,
  url: string
): Promise<{ results: SearchResultItem[]; html: string }> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await page
    .waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll('script[type="application/json"]')
        ).some((s) =>
          (s.textContent ?? "").includes("marketplace_listing_title")
        ),
      { timeout: 20_000 }
    )
    .catch(() => undefined);

  const blobText: string[] = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('script[type="application/json"]')
    ).map((s) => s.textContent ?? "")
  );
  const blobs: unknown[] = [];
  for (const t of blobText) {
    try {
      blobs.push(JSON.parse(t));
    } catch {
      /* ignore */
    }
  }

  const html = await page.content();

  if (blobs.length === 0) {
    const loggedOut = /log in|you must log in/i.test(
      await page.title().catch(() => "")
    );
    if (loggedOut) {
      const err = new Error("logged_out") as Error & { loggedOut: boolean };
      err.loggedOut = true;
      throw err;
    }
  }

  const nodes = collectByKey(blobs, "marketplace_listing_title");
  const byId = new Map<string, SearchResultItem>();
  for (const node of nodes) {
    const id = str(node.id);
    const title = str(get(node, "marketplace_listing_title"));
    // Skip nodes that aren't real listing tiles (need an id + title).
    if (!id || !title) continue;
    const key = id;
    if (byId.has(key)) continue;
    byId.set(key, {
      fbItemId: id,
      url: `https://www.facebook.com/marketplace/item/${id}/`,
      title,
      priceCents: summaryPriceCents(node),
      thumbnailUrl: summaryThumb(node),
    });
  }

  return { results: [...byId.values()], html };
}

/** Lightweight logged-in check: Marketplace shows a login wall when logged out. */
export async function isLoggedIn(page: Page): Promise<boolean> {
  await page
    .goto("https://www.facebook.com/marketplace/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    })
    .catch(() => undefined);
  const url = page.url();
  if (/\/login|login\.php|checkpoint/.test(url)) return false;
  const title = await page.title().catch(() => "");
  return !/log in|log into facebook/i.test(title);
}
