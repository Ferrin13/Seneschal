import type {
  Candidate,
  CandidateStatus,
  Disposition,
  Platform,
} from "../api";

export function money(cents: number | null | undefined): string {
  return cents != null ? `$${(cents / 100).toFixed(2)}` : "—";
}

export function ageText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

/** Relative time down to the minute: "just now", "5m ago", "3h ago", "2d ago". */
export function ageTextFine(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const PLATFORM_COLOR: Record<Platform, "primary" | "secondary"> = {
  facebook: "primary",
  craigslist: "secondary",
};

/** Short source tag shown inline with a listing title (FB / CL). */
export const SOURCE_SHORT: Record<Platform, string> = {
  facebook: "FB",
  craigslist: "CL",
};

export const TRIAGE: Record<
  "promising" | "rejected" | "skipped",
  { label: string; color: "info" | "error" | "default" }
> = {
  promising: { label: "promising", color: "info" },
  rejected: { label: "rejected", color: "error" },
  skipped: { label: "skipped", color: "default" },
};

export const TABS: { value: CandidateStatus | "all"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "sold", label: "Likely sold" },
  { value: "disappeared", label: "Disappeared" },
  { value: "all", label: "All" },
];

export type SortKey = "deal" | "value" | "fit" | "added" | "updated";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "deal", label: "Best deal" },
  { value: "value", label: "Value (high→low)" },
  { value: "fit", label: "Fit (high→low)" },
  { value: "added", label: "Recently added" },
  { value: "updated", label: "Recently updated" },
];

export type PostedWithin = "any" | "1" | "7" | "30";

export const POSTED_WITHIN: { value: PostedWithin; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "1", label: "Past 24 hours" },
  { value: "7", label: "Past 7 days" },
  { value: "30", label: "Past 30 days" },
];

export const PLATFORMS: Platform[] = ["facebook", "craigslist"];

export const DISPOSITION: Record<
  Disposition,
  { label: string; color: "default" | "info" | "primary" | "success" | "error" }
> = {
  none: { label: "No disposition", color: "default" },
  not_a_fit: { label: "Not a fit", color: "error" },
  not_a_good_deal: { label: "Not good value", color: "error" },
  keep_watching: { label: "Keep watching", color: "info" },
  reached_out: { label: "Reached out", color: "primary" },
  sold: { label: "Sold", color: "success" },
};

/**
 * Subtle background tint used to signal a candidate's disposition on cards and
 * in the detail panel (paired with a small text label). `none` has no tint.
 */
export const DISPOSITION_TINT: Record<Disposition, string | undefined> = {
  none: undefined,
  not_a_fit: "rgba(211, 47, 47, 0.08)",
  not_a_good_deal: "rgba(211, 47, 47, 0.08)",
  keep_watching: "rgba(2, 136, 209, 0.10)",
  reached_out: "rgba(25, 118, 210, 0.10)",
  sold: "rgba(46, 125, 50, 0.10)",
};

/**
 * Opaque equivalents of {@link DISPOSITION_TINT} (each tint flattened over the
 * white paper background). Used by the detail panel so a sticky element (the
 * close bar) can match the panel background exactly without letting scrolled
 * content bleed through a translucent color.
 */
export const DISPOSITION_PANEL_BG: Record<Disposition, string | undefined> = {
  none: undefined,
  not_a_fit: "#fbeeee",
  not_a_good_deal: "#fbeeee",
  keep_watching: "#e6f3fa",
  reached_out: "#e8f1fb",
  sold: "#eaf2eb",
};

export const DISPOSITION_OPTIONS: Disposition[] = [
  "none",
  "not_a_fit",
  "not_a_good_deal",
  "keep_watching",
  "reached_out",
  "sold",
];

/** Dispositions shown by default: undecided, watching, and reached-out deals. */
export const DEFAULT_DISPOSITIONS: Disposition[] = [
  "none",
  "keep_watching",
  "reached_out",
];

export function candidateValue(c: Candidate): number | null {
  return c.evaluation?.valueScore ?? null;
}

export function candidateFit(c: Candidate): number | null {
  return c.evaluation?.fitScore ?? c.triageScore ?? null;
}

/**
 * Combine the value (price vs. market) and fit scores into a single 0-100
 * "deal score" — the headline ranking metric. It's the average of the two, so
 * a candidate must be both a good price and a good match to rank highly. Falls
 * back to whichever score exists when only one is available.
 */
export function combineDealScore(
  value: number | null,
  fit: number | null
): number | null {
  if (value == null && fit == null) return null;
  if (value == null) return fit;
  if (fit == null) return value;
  return (value + fit) / 2;
}

/** The combined deal score for a candidate (see {@link combineDealScore}). */
export function candidateDealScore(c: Candidate): number | null {
  return combineDealScore(candidateValue(c), candidateFit(c));
}

/** Newest-first comparator over an ISO-date accessor; nulls sink to the end. */
export function byDateDesc(get: (c: Candidate) => string | null) {
  return (a: Candidate, b: Candidate) => {
    const ta = get(a) ? new Date(get(a)!).getTime() : -Infinity;
    const tb = get(b) ? new Date(get(b)!).getTime() : -Infinity;
    return tb - ta;
  };
}

/** Pull a human-readable reason/error out of an event's detail JSON. */
export function eventReason(
  detail: Record<string, unknown> | null
): string | null {
  if (!detail) return null;
  const reason = detail.reason ?? detail.error;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

export const STAGE_LABEL: Record<string, string> = {
  discovered: "Discovered",
  triaged: "Triaged",
  deep_scraped: "Deep scraped",
  comps_gathered: "Comps gathered",
  evaluated: "Evaluated",
  sold: "Likely sold",
  disappeared: "Disappeared",
  error: "Error",
};
