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

/** Coarse OS family parsed from the CDP-reported User-Agent. */
export type BrowserPlatform = "windows" | "mac" | "linux" | "unknown";

/**
 * Snapshot of the tunneled-browser path as seen from the agent host. Mirrors
 * the backend's `BrowserProbe` in `temporal/types.ts`; keep in sync.
 */
export type BrowserProbe = {
  agentName: string;
  checkedAt: string;
  /** What (if anything) answers CDP on the agent's configured CDP URL. */
  cdp: {
    url: string;
    reachable: boolean;
    browser: string | null;
    userAgent: string | null;
    platform: BrowserPlatform | null;
    error: string | null;
  };
  /**
   * Whether the browser holds a Facebook session cookie (`c_user`). Null when
   * CDP is unreachable or the check failed.
   */
  facebookLoggedIn: boolean | null;
  /**
   * Who owns the listening sockets on the box's port 9222, from the root
   * helper (`seneschal-tunnel-ctl status`). `available: false` when the
   * helper isn't installed (e.g. running the agent locally).
   */
  tunnel: {
    available: boolean;
    ipv4Holder: string | null;
    ipv6Holder: string | null;
    legacyChromeActive: boolean | null;
    error: string | null;
  };
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
