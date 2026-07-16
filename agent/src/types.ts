/**
 * Wire shapes returned by the browser-box activities. These mirror the
 * backend's `marketplace/types.ts` (HarvestedItem / DeepListing) so the
 * Temporal payloads deserialize cleanly on the backend worker side. Keep them
 * in sync with the backend.
 */

export type HarvestedItem = {
  platform: "facebook";
  externalId: string | null;
  url: string;
  title: string | null;
  priceCents: number | null;
  thumbnailUrl: string | null;
  listedAt?: string | null;
};

export type DeepImage = {
  sourceUrl: string;
  imageKey?: string | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
};

/** Result of re-fetching a listing PDP to confirm it's gone/sold. */
export type VerifyResult = {
  gone: boolean;
  reason: string | null;
};

export type DeepListing = {
  platform: "facebook";
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
