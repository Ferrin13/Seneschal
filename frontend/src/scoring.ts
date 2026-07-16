/**
 * Frontend mirror of the backend deal-scoring thresholds. Evaluations carry a
 * `valueScore` (price vs. market) and `fitScore` (match to the user's target),
 * each 0-100. The value score maps to a labelled tier + chip color; confidence
 * is a secondary signal shown only in tooltips/detail, not as a headline chip.
 */

export type DealTier = "great_deal" | "good_deal" | "maybe" | "pass";

export const DEAL_TIER: Record<
  DealTier,
  { label: string; color: "success" | "warning" | "error" }
> = {
  great_deal: { label: "Great deal", color: "success" },
  good_deal: { label: "Good deal", color: "success" },
  maybe: { label: "Maybe", color: "warning" },
  pass: { label: "Pass", color: "error" },
};

export function dealTier(value: number | null | undefined): DealTier | null {
  if (value == null) return null;
  if (value >= 85) return "great_deal";
  if (value >= 65) return "good_deal";
  if (value >= 40) return "maybe";
  return "pass";
}

/** Chip color for a 0-100 fit score. */
export function fitColor(
  fit: number | null | undefined
): "success" | "warning" | "error" | "default" {
  if (fit == null) return "default";
  if (fit >= 65) return "success";
  if (fit >= 40) return "warning";
  return "error";
}
