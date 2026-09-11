import { ApplicationFailure } from "@temporalio/common";
import { config } from "./config.js";
import { getContext, isFacebookLoggedIn, resetConnection } from "./browser.js";
import { scrapeListing, scrapeSearch } from "./extract.js";
import { probeCdp, rebuildTunnel, tunnelStatus } from "./tunnel.js";
import type {
  BrowserProbe,
  DeepListing,
  HarvestedItem,
  VerifyResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Tunneled-browser health. These back the deal hunter's "browser status"
// panel: the backend runs them on demand through a short workflow, so a
// missing worker (box down / agent stopped) surfaces as a schedule-to-start
// timeout on the backend side rather than an error here.
// ---------------------------------------------------------------------------

/** Inspect CDP + the tunnel and, if a browser answers, its Facebook session. */
export async function browserStatus(): Promise<BrowserProbe> {
  const [cdp, tunnel] = await Promise.all([probeCdp(), tunnelStatus()]);
  let facebookLoggedIn: boolean | null = null;
  if (cdp.reachable) {
    try {
      facebookLoggedIn = await isFacebookLoggedIn(await getContext());
    } catch {
      facebookLoggedIn = null;
    }
  }
  return {
    agentName: config.agentName,
    checkedAt: new Date().toISOString(),
    cdp,
    facebookLoggedIn,
    tunnel,
  };
}

/** Drop the cached CDP connection and reconnect, then report status. */
export async function browserReconnect(): Promise<BrowserProbe> {
  await resetConnection();
  return browserStatus();
}

/**
 * Rebuild the tunnel path via the root helper (stop legacy on-box Chrome,
 * bounce the reverse-forward SSH session so the operator's keep-alive script
 * reconnects), then reconnect CDP and report status. The tunnel field carries
 * the helper's error if it isn't installed or failed.
 */
export async function browserRebuildTunnel(): Promise<BrowserProbe> {
  const rebuilt = await rebuildTunnel();
  await resetConnection();
  const status = await browserStatus();
  // Prefer the rebuild's own error (e.g. sudo missing) over a clean re-read.
  if (!rebuilt.available) return { ...status, tunnel: rebuilt };
  return status;
}

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

const GONE_STATUS = /sold|out.?of.?stock|unavailable|not.?available|deleted/i;

/**
 * Re-open a Facebook listing PDP to confirm a vanished candidate is really gone
 * before we mark it sold. Gone = the listing reports sold/unavailable, or the
 * embedded detail block is missing (deleted post). A still-live page or any
 * non-login error counts as not gone so we never false-positive a "sold".
 */
export async function fbVerifyListing(input: {
  url: string;
}): Promise<VerifyResult> {
  const context = await getContext();
  const page = await context.newPage();
  try {
    const { listing } = await scrapeListing(page, input.url);
    if (listing.isSold === true) return { gone: true, reason: "is_sold" };
    if (listing.availabilityStatus && GONE_STATUS.test(listing.availabilityStatus)) {
      return { gone: true, reason: `status:${listing.availabilityStatus}` };
    }
    // Deleted posts render no detail block -> partial scrape with no content.
    if (
      listing.scrapeStatus !== "ok" &&
      !listing.title &&
      listing.priceCents == null
    ) {
      return { gone: true, reason: "no_detail" };
    }
    return { gone: false, reason: "still_live" };
  } catch (err) {
    if ((err as { loggedOut?: boolean }).loggedOut) throw loggedOutFailure();
    return { gone: false, reason: `error:${(err as Error).message}` };
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
