/**
 * Throwaway exploration: dump Facebook's embedded JSON for a Marketplace
 * listing so we can design a robust parser. Finds every
 * <script type="application/json"> blob, recursively searches for an object
 * carrying `marketplace_listing_title`, and writes the first match (plus a
 * shallow key map) to scripts/out.
 *
 *   npx tsx scripts/explore-embedded.ts "<marketplace-url>"
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP_URL = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";

// Fields we want to locate. FB spreads the listing across many blobs, so we
// hunt for the first object containing each marker independently.
const MARKERS = [
  "marketplace_listing_title",
  "listing_photos",
  "primary_listing_photo",
  "redacted_description",
  "marketplace_listing_seller",
  "creation_time",
  "story",
] as const;

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: npx tsx scripts/explore-embedded.ts "<url>"');
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(4_000);

    const blobs: string[] = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('script[type="application/json"]')
      ).map((s) => s.textContent ?? "")
    );

    console.log(`Found ${blobs.length} application/json script blobs.`);

    // For each marker, keep the object with the MOST keys that contains it
    // (richest representation) across every blob.
    const best = new Map<string, Record<string, unknown>>();
    const search = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const v of node) search(v);
        return;
      }
      const obj = node as Record<string, unknown>;
      for (const marker of MARKERS) {
        if (marker in obj) {
          const prev = best.get(marker);
          if (!prev || Object.keys(obj).length > Object.keys(prev).length) {
            best.set(marker, obj);
          }
        }
      }
      for (const v of Object.values(obj)) search(v);
    };

    for (const b of blobs) {
      try {
        search(JSON.parse(b));
      } catch {
        /* not all blobs are valid standalone JSON */
      }
    }

    const here = dirname(fileURLToPath(import.meta.url));
    const outDir = join(here, "out");
    await mkdir(outDir, { recursive: true });

    for (const marker of MARKERS) {
      const obj = best.get(marker);
      if (!obj) {
        console.log(`- ${marker}: NOT FOUND`);
        continue;
      }
      console.log(
        `- ${marker}: object with ${Object.keys(obj).length} keys -> ` +
          `keys: ${Object.keys(obj).sort().join(", ")}`
      );
      await writeFile(
        join(outDir, `embedded-${marker}.json`),
        JSON.stringify(obj, null, 2),
        "utf8"
      );
    }
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("Explore failed:", err);
  process.exit(1);
});
