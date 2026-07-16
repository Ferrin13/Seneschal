/**
 * Source-agnostic shapes shared across the pipeline. Both the Facebook
 * browser worker and the server-side Craigslist connector produce these, so
 * the workflow/activities and the listing-upsert code stay platform-neutral.
 */

export type Platform = "facebook" | "craigslist";

/** A listing tile harvested from a search results snapshot. */
export type HarvestedItem = {
  platform: Platform;
  /** Platform item id when known (else null; dedupe falls back to the URL). */
  externalId: string | null;
  url: string;
  title: string | null;
  priceCents: number | null;
  thumbnailUrl: string | null;
  /** Source-reported post time, if the snapshot exposes it. */
  listedAt?: string | null;
};

export type DeepImage = {
  sourceUrl: string;
  imageKey?: string | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
};

/** A fully-scraped listing (PDP), mapped 1:1 onto the mp_listings columns. */
export type DeepListing = {
  platform: Platform;
  externalId: string | null;
  url: string;
  title: string | null;
  description: string | null;
  priceCents: number | null;
  currency: string | null;
  conditionCode?: string | null;
  conditionLabel: string | null;
  categoryId?: string | null;
  categoryPath?: string[];
  locationText: string | null;
  latitude: number | null;
  longitude: number | null;
  sellerId?: string | null;
  sellerName: string | null;
  sellerProfileUrl?: string | null;
  sellerRatingAverage?: number | null;
  sellerRatingCount?: number | null;
  availabilityStatus?: string | null;
  isSold?: boolean | null;
  isPending?: boolean | null;
  listedAt: string | null;
  sourceUpdatedAt: string | null;
  images: DeepImage[];
  rawExtract: Record<string, unknown> | null;
  scrapeStatus: "ok" | "partial" | "failed";
};
