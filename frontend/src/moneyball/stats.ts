/**
 * Moneyball stat catalog + scoring, mirrored from backend/src/moneyball/engine.ts
 * so the card can preview OVR live while the user drags sliders. Keep in sync.
 */

export const CATEGORIES = ["offense", "defense", "general"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  offense: "Offense",
  defense: "Defense",
  general: "General",
};

export const CATEGORY_ABBR: Record<Category, string> = {
  offense: "OFF",
  defense: "DEF",
  general: "GEN",
};

export const STAT_KEYS = [
  "short_handling",
  "huck_handling",
  "short_cutting",
  "deep_cutting",
  "decision_making",
  "handler_marking",
  "cutter_marking",
  "verticality",
  "agility",
  "team_chemistry",
  "effort",
  "game_iq",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type StatDef = { key: StatKey; label: string; category: Category };

export const STATS: readonly StatDef[] = [
  { key: "short_handling", label: "Short Handling", category: "offense" },
  { key: "huck_handling", label: "Hucking Handling", category: "offense" },
  { key: "short_cutting", label: "Short Cutting", category: "offense" },
  { key: "deep_cutting", label: "Deep Cutting", category: "offense" },
  { key: "decision_making", label: "Decision Making", category: "offense" },
  { key: "handler_marking", label: "Handler Marking", category: "defense" },
  { key: "cutter_marking", label: "Cutter Marking", category: "defense" },
  { key: "verticality", label: "Verticality", category: "general" },
  { key: "agility", label: "Agility", category: "general" },
  { key: "team_chemistry", label: "Team Chemistry", category: "general" },
  { key: "effort", label: "Effort", category: "general" },
  { key: "game_iq", label: "Game IQ", category: "general" },
];

export function statsInCategory(category: Category): StatDef[] {
  return STATS.filter((s) => s.category === category);
}

export const MIN_SCORE = 1;
export const MAX_SCORE = 10;
export const MIN_WEIGHT = 0;
export const MAX_WEIGHT = 5;

export type Scores = Partial<Record<StatKey, number>>;
export type Weights = Record<StatKey, number>;
export type StatMeans = Record<StatKey, number | null>;

export type Scorecard = {
  overall: number | null;
  offense: number | null;
  defense: number | null;
  general: number | null;
};

export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(
  STAT_KEYS.map((k) => [k, 1])
) as Weights;

export function meansFromScores(scores: Scores): StatMeans {
  return Object.fromEntries(
    STAT_KEYS.map((k) => [k, scores[k] ?? null])
  ) as StatMeans;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function weightedMean(
  means: StatMeans,
  weights: Weights,
  keys: readonly StatKey[]
): number | null {
  let num = 0;
  let den = 0;
  for (const k of keys) {
    const m = means[k];
    const w = weights[k] ?? 0;
    if (m == null || !(w > 0)) continue;
    num += m * w;
    den += w;
  }
  return den > 0 ? round1(num / den) : null;
}

export function score(means: StatMeans, weights: Weights): Scorecard {
  const cat = (c: Category) =>
    weightedMean(
      means,
      weights,
      statsInCategory(c).map((s) => s.key)
    );
  return {
    overall: weightedMean(means, weights, STAT_KEYS),
    offense: cat("offense"),
    defense: cat("defense"),
    general: cat("general"),
  };
}

/** Format a 1-10 score for display ("7.4", or "–" when unrated). */
export function fmtScore(v: number | null | undefined): string {
  return v == null ? "–" : v.toFixed(1);
}

/**
 * Colour band for a 1-10 score, Madden-style: elite green, solid blue,
 * average amber, weak red. Returns an MUI palette key.
 */
export function scoreTone(
  v: number | null | undefined
): "success" | "info" | "warning" | "error" | "default" {
  if (v == null) return "default";
  if (v >= 8.5) return "success";
  if (v >= 7) return "info";
  if (v >= 5) return "warning";
  return "error";
}
