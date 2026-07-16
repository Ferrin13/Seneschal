import { chromium } from "playwright";
import { scrapeListing } from "./extract.js";

/**
 * Dev helper: scrape a single listing URL and print the structured JSON.
 *   CHROME_CDP_URL=http://127.0.0.1:9222 npx tsx src/scrapeOnce.ts <url>
 */
async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: scrapeOnce <marketplace-url>");
    process.exit(1);
  }
  const cdpUrl = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  try {
    const { listing } = await scrapeListing(page, url);
    console.log(JSON.stringify(listing, null, 2));
  } finally {
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
