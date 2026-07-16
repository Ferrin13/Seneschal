import type { HarvestedItem, DeepListing, Platform } from "../marketplace/types.js";

/** A search the workflow iterates over. */
export type SearchRef = {
  id: string;
  platform: Platform;
  query: string;
  searchUrl: string | null;
};

/** A candidate reference the workflow carries between activities. */
export type CandidateRef = {
  id: string;
  platform: Platform;
  url: string;
  externalId: string | null;
  /**
   * Whether this candidate should be (re-)triaged this run. True for newly
   * discovered tiles and for re-seen ones whose price/title changed (or that
   * were never successfully triaged). Unchanged re-seen tiles are skipped to
   * avoid redundant LLM calls.
   */
  needsTriage: boolean;
};

/** A promising candidate that vanished from search and needs a PDP re-check. */
export type VerifyRef = {
  id: string;
  platform: Platform;
  url: string;
  title: string | null;
  misses: number;
};

/** Result of re-fetching a listing's PDP to confirm it's really gone. */
export type VerifyResult = {
  gone: boolean;
  reason: string | null;
};

/** Temporal traceability passed to activities so events link back to a run. */
export type RunMeta = {
  userId: string;
  workflowId: string;
  runId: string;
  model?: string;
};

/**
 * Activities serviced by the browser-box worker (Facebook, which needs the
 * logged-in Chrome). Declared here so the workflow can proxy them by name on
 * the browser task queue; the implementations live in the agent package.
 */
export interface BrowserActivities {
  fbHarvestSearch(input: { searchUrl: string }): Promise<HarvestedItem[]>;
  fbDeepScrape(input: { url: string }): Promise<DeepListing>;
  /** Re-open a listing PDP to confirm it's gone/sold before we mark it sold. */
  fbVerifyListing(input: { url: string }): Promise<VerifyResult>;
}
