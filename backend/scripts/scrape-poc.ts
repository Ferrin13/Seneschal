/**
 * Marketplace Scraper POC (embedded-JSON edition).
 *
 * Attaches to an already-running, FB-logged-in Chrome over the DevTools
 * Protocol, navigates to a Marketplace listing, and extracts the structured
 * listing data from Facebook's own embedded JSON (the Relay payload inlined in
 * <script type="application/json"> blobs) rather than scraping the DOM. Falls
 * back to page title if the embedded payload can't be found. Writes the result
 * to a JSON file. No DB, S3, or API involved.
 *
 * Prereq: start Chrome with remote debugging using the profile that is
 * logged into Facebook, e.g.
 *   & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
 *     --remote-debugging-port=9222 `
 *     --user-data-dir="$env:USERPROFILE\chrome-debug-profile"
 *
 * Run:
 *   npx tsx scripts/scrape-poc.ts "<marketplace-url>"
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Default to 127.0.0.1 (not "localhost"): on Windows "localhost" often
// resolves to IPv6 ::1 first, but Chrome binds the debug port on IPv4, which
// surfaces as ECONNREFUSED ::1:9222.
const CDP_URL = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";

type Json = Record<string, unknown>;

function parseItemId(url: string): string | null {
  const m = url.match(/\/marketplace\/item\/(\d+)/);
  return m ? m[1]! : null;
}

/** Collect every plain object anywhere in `root` that owns `key`. */
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

/** Of the objects owning `key`, return the one with the most keys. */
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

function buildListing(blobs: unknown[], url: string, fbItemId: string | null) {
  // The full product-detail object owns the description; photos live in a
  // sibling node that owns `listing_photos`; the taxonomy lives in a node that
  // owns `seo_virtual_category`.
  const detail =
    richestByKey(blobs, "redacted_description") ??
    richestByKey(blobs, "marketplace_listing_title");
  const photosNode = richestByKey(blobs, "listing_photos");
  const seoNode = richestByKey(blobs, "seo_virtual_category");

  if (!detail) return null;

  const priceAmount = str(get(detail, "listing_price.amount"));
  const priceOffset = str(get(detail, "listing_price.amount_with_offset_in_currency"));
  const priceCents =
    priceOffset && /^\d+$/.test(priceOffset)
      ? Number(priceOffset)
      : priceAmount
        ? Math.round(Number(priceAmount) * 100)
        : null;

  // Condition: prefer the human label from attribute_data.
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
  const images = Array.isArray(photos)
    ? photos
        .map((p) => {
          const img = (p as Json)?.image as Json | undefined;
          return {
            id: str((p as Json)?.id),
            url: str(img?.uri),
            width: num(img?.width),
            height: num(img?.height),
            caption: str((p as Json)?.accessibility_caption),
          };
        })
        .filter((p) => p.url)
    : [];

  const creationTime = num(get(detail, "creation_time"));

  return {
    fbItemId: fbItemId ?? str(detail.id),
    title:
      str(get(detail, "marketplace_listing_title")) ??
      str(get(detail, "base_marketplace_listing_title")),
    description: str(get(detail, "redacted_description.text")),
    price: {
      amount: priceAmount,
      cents: priceCents,
      currency: str(get(detail, "listing_price.currency")),
      formatted:
        str(get(detail, "listing_price.formatted_amount_zeros_stripped")) ??
        str(get(detail, "formatted_price.text")),
    },
    condition: {
      code: str(get(detail, "condition")),
      label: conditionLabel,
    },
    category: {
      id: str(get(detail, "marketplace_listing_category_id")),
      path: categoryPath,
    },
    location: {
      text: str(get(detail, "location_text.text")),
      latitude: num(get(detail, "location.latitude")),
      longitude: num(get(detail, "location.longitude")),
    },
    seller: {
      id: sellerId,
      name: str(seller?.name),
      profileUrl: sellerId ? `https://www.facebook.com/${sellerId}` : null,
      ratingAverage: num(
        get(
          seller ?? null,
          "marketplace_ratings_stats_by_role_v2.seller_stats.five_star_ratings_average"
        )
      ),
      ratingCount: num(
        get(
          seller ?? null,
          "marketplace_ratings_stats_by_role_v2.seller_stats.five_star_total_rating_count_by_role"
        )
      ),
      joinTime: num(seller?.join_time),
    },
    availability: {
      status: str(get(detail, "renderable_listing_status")),
      isSold: get(detail, "is_sold") === true,
      isPending: get(detail, "is_pending") === true,
      isLive: get(detail, "is_live") === true,
    },
    createdAt: creationTime
      ? new Date(creationTime * 1000).toISOString()
      : null,
    images,
  };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npx tsx scripts/scrape-poc.ts "<marketplace-url>"');
    process.exit(1);
  }

  const fbItemId = parseItemId(url);

  console.log(`Connecting to Chrome at ${CDP_URL} ...`);
  const browser = await chromium.connectOverCDP(CDP_URL);

  // Reuse the existing authenticated context — this is what carries the
  // Facebook login/cookies. A fresh context would be logged out.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();

  try {
    console.log(`Navigating to ${url} ...`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // The embedded JSON is injected as the Relay store hydrates; give it a
    // moment and wait for the marker to appear in the DOM.
    await page
      .waitForFunction(
        () =>
          Array.from(
            document.querySelectorAll('script[type="application/json"]')
          ).some((s) => (s.textContent ?? "").includes("marketplace_listing_title")),
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

    const listing = buildListing(blobs, url, fbItemId);
    const pageTitle = await page.title();

    const result = {
      url,
      fbItemId,
      scrapedAt: new Date().toISOString(),
      source: listing ? "embedded-json" : "fallback",
      pageTitle,
      listing,
    };

    const here = dirname(fileURLToPath(import.meta.url));
    const outDir = join(here, "out");
    await mkdir(outDir, { recursive: true });
    const fileName = `${fbItemId ?? Date.now()}.json`;
    const outPath = join(outDir, fileName);
    await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");

    console.log(`\nScraped listing written to: ${outPath}`);
    console.log(JSON.stringify(result, null, 2));

    if (!listing) {
      console.warn(
        "\nWARNING: embedded listing JSON not found — only page title captured."
      );
    }
  } finally {
    // Only close our page — never the user's browser/context.
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
