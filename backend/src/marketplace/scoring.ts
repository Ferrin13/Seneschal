/**
 * Shared deal-scoring logic. Evaluations produce two independent 0-100 scores:
 *
 *  - `valueScore` — how good the price is versus estimated market/resale value.
 *  - `fitScore`   — how well the listing matches the user's target + rules.
 *
 * The value score maps onto a human label via fixed thresholds, and the two
 * scores blend into the `promiseScore` used to rank the candidate feed. A
 * separate `confidence` (0-1) is retained on evaluations but is a secondary
 * signal, not a headline metric.
 */

export type DealTier = "great_deal" | "good_deal" | "maybe" | "pass";

/** Value-score cutoffs (inclusive lower bound) for each deal tier. */
export const VALUE_THRESHOLDS: { tier: DealTier; min: number }[] = [
  { tier: "great_deal", min: 85 },
  { tier: "good_deal", min: 65 },
  { tier: "maybe", min: 40 },
  { tier: "pass", min: 0 },
];

/**
 * Legacy notification cutoffs. Notification gating is now driven by per-user
 * preferences (see `notificationSettings.ts`); `GOOD_DEAL_MIN` is retained as
 * the default value threshold for new users.
 */
export const GOOD_DEAL_MIN = 65;
export const NOTIFY_FIT_MIN = 50;

export function dealTier(value: number | null): DealTier | null {
  if (value == null) return null;
  for (const t of VALUE_THRESHOLDS) {
    if (value >= t.min) return t.tier;
  }
  return "pass";
}

/**
 * Legacy `mp_evaluation_verdict` enum value, derived from the value score so
 * older reads/filters keep working while we transition to numeric scores.
 */
export function legacyVerdict(
  value: number | null
): "good_deal" | "pass" | "unsure" {
  const tier = dealTier(value);
  if (tier === "great_deal" || tier === "good_deal") return "good_deal";
  if (tier === "maybe") return "unsure";
  return "pass";
}

/**
 * Blend value + fit into a single 0-100 ranking score. We rank the feed by the
 * simple average of deal quality and target fit so a candidate has to be both a
 * good price AND a good match to float to the top. When only one score exists
 * (e.g. a triaged-but-not-yet-evaluated candidate has fit only), it stands in
 * for the pair.
 */
export function promiseScore(
  value: number | null,
  fit: number | null
): number {
  if (value == null && fit == null) return 0;
  if (value == null) return fit ?? 0;
  if (fit == null) return value;
  return Math.round((value + fit) / 2);
}

/**
 * Absolute-savings scale in USD. Dollars saved are run through a saturating
 * curve `1 - e^(-savings / SCALE)`, so this is roughly the savings at which the
 * absolute component reaches ~63/100. Larger absolute savings keep climbing
 * toward 100 but with diminishing returns.
 */
export const ABS_SAVINGS_SCALE_USD = 800;
/** Percentage discount (of estimated value) that maps to a full 100 on the % axis. */
export const FULL_DISCOUNT_PCT = 0.5;
/**
 * Weight of the absolute-savings component vs. the percentage component. >0.5
 * so absolute dollars saved dominate: a $2,000 saving on a $5,000 hot tub beats
 * a $15 saving on a $20 game even though the game's percentage is higher.
 */
export const ABS_SAVINGS_WEIGHT = 0.65;

/**
 * Deal/value score (0-100) derived from the asking price vs. estimated market
 * value. Blends how much money is saved in absolute terms (weighted heavier)
 * with the percentage discount. Returns null when we can't compute savings
 * (missing price/estimate), so callers can fall back to the model's own score.
 */
export function dealScore(
  priceCents: number | null,
  estimatedValueCents: number | null
): number | null {
  if (priceCents == null || estimatedValueCents == null) return null;
  if (estimatedValueCents <= 0) return null;

  const savingsCents = estimatedValueCents - priceCents;

  // Percentage component: share of the item's value that's saved. 50%+ off
  // saturates the axis; at/above market price contributes 0.
  const pct = savingsCents / estimatedValueCents;
  const pctScore = Math.max(0, Math.min(100, (pct / FULL_DISCOUNT_PCT) * 100));

  // Absolute component: raw dollars saved, saturating so big-ticket savings
  // dominate small ones regardless of percentage. Overpriced items save $0.
  const savingsUsd = Math.max(0, savingsCents / 100);
  const absScore = 100 * (1 - Math.exp(-savingsUsd / ABS_SAVINGS_SCALE_USD));

  const blended =
    ABS_SAVINGS_WEIGHT * absScore + (1 - ABS_SAVINGS_WEIGHT) * pctScore;
  return Math.max(0, Math.min(100, Math.round(blended)));
}

/** Clamp an arbitrary LLM number to an integer in [0, 100], or null. */
export function clampScore(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.min(100, Math.round(n)))
    : null;
}
