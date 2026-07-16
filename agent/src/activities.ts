import { ApplicationFailure } from "@temporalio/common";
import { config } from "./config.js";
import { getContext } from "./browser.js";
import { scrapeListing, scrapeSearch } from "./extract.js";
import type { DeepListing, HarvestedItem } from "./types.js";

/** Wrap a logged-out signal as a non-retryable failure the workflow detects. */
function loggedOutFailure(): ApplicationFailure {
  return ApplicationFailure.create({
    message: "logged_out",
    type: "logged_out",
    nonRetryable: true,
  });
}

/**
 * Harvest all listing tiles from a Facebook Marketplace search results page.
 * Pure load-and-parse of the embedded JSON — no clicking or scrolling.
 */
export async function fbHarvestSearch(input: {
  searchUrl: string;
}): Promise<HarvestedItem[]> {
  const context = await getContext();
  const page = await context.newPage();
  try {
    const { results } = await scrapeSearch(page, input.searchUrl);
    return results.map((r) => ({
      platform: "facebook" as const,
      externalId: r.fbItemId,
      url: r.url,
      title: r.title,
      priceCents: r.priceCents,
      thumbnailUrl: r.thumbnailUrl,
    }));
  } catch (err) {
    if ((err as { loggedOut?: boolean }).loggedOut) throw loggedOutFailure();
    throw err;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Deep-scrape a single Facebook Marketplace listing (PDP) via embedded JSON.
 */
export async function fbDeepScrape(input: {
  url: string;
}): Promise<DeepListing> {
  const context = await getContext();
  const page = await context.newPage();
  try {
    const { listing } = await scrapeListing(page, input.url);
    return {
      platform: "facebook",
      externalId: listing.fbItemId,
      url: listing.url,
      title: listing.title,
      description: listing.description,
      priceCents: listing.priceCents,
      currency: listing.currency,
      conditionCode: listing.conditionCode,
      conditionLabel: listing.conditionLabel,
      categoryId: listing.categoryId,
      categoryPath: listing.categoryPath,
      locationText: listing.locationText,
      latitude: listing.latitude,
      longitude: listing.longitude,
      sellerId: listing.sellerId,
      sellerName: listing.sellerName,
      sellerProfileUrl: listing.sellerProfileUrl,
      sellerRatingAverage: listing.sellerRatingAverage,
      sellerRatingCount: listing.sellerRatingCount,
      availabilityStatus: listing.availabilityStatus,
      isSold: listing.isSold,
      isPending: listing.isPending,
      listedAt: listing.listedAt,
      sourceUpdatedAt: null,
      images: listing.images.slice(0, config.maxImages).map((img) => ({
        sourceUrl: img.sourceUrl,
        width: img.width,
        height: img.height,
        caption: img.caption,
      })),
      rawExtract: listing.rawExtract,
      scrapeStatus: listing.scrapeStatus,
    };
  } catch (err) {
    if ((err as { loggedOut?: boolean }).loggedOut) throw loggedOutFailure();
    throw err;
  } finally {
    await page.close().catch(() => undefined);
  }
}
