/**
 * Product catalog, mirrored from backend/src/auth/access.ts. Order here is
 * the order tabs render in. Android-only products (expenses, group texting)
 * have no web section but still appear on the admin page.
 */
export const FEATURES = [
  "time_tracking",
  "expenses",
  "group_texting",
  "deal_hunter",
  "lazax",
  "thrawn",
  "descartes",
  "moneyball",
] as const;

export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  time_tracking: "Time Tracking",
  expenses: "Expense Tracking",
  group_texting: "Group Texting",
  deal_hunter: "Deal Hunter",
  lazax: "Lazax",
  thrawn: "Thrawn",
  descartes: "Descartes",
  moneyball: "Moneyball",
};

/** Short blurb shown on the admin page to explain what each toggle unlocks. */
export const FEATURE_HINTS: Record<Feature, string> = {
  time_tracking: "Time tracking + voice assistant (Android; read-only on web)",
  expenses: "Expense tracking and receipt uploads (Android)",
  group_texting: "Group texting and message templates (Android)",
  deal_hunter: "Marketplace deal pipeline, targets, and LLM settings",
  lazax: "Twilight Imperium game tracker",
  thrawn: "Fantasy football analyzer",
  descartes: "Belief graph and scripture lookup",
  moneyball: "Ultimate frisbee player ratings",
};

export function isFeature(value: unknown): value is Feature {
  return (
    typeof value === "string" && (FEATURES as readonly string[]).includes(value)
  );
}
