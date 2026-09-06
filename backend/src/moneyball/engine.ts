/**
 * Moneyball scoring engine — pure, I/O-free.
 *
 * Every player is rated 1-10 on a fixed catalog of stats grouped into three
 * categories. Multiple raters each submit their own scores; the engine first
 * averages each stat across raters, then folds those means into category
 * scores and an overall (OVR) using a shared, editable weight per stat.
 *
 * Missing data is handled at both levels: a rater may skip a stat (it simply
 * doesn't count toward that stat's mean), and a stat with no ratings at all is
 * excluded from any score it would have contributed to. A stat whose weight is
 * 0 is excluded too. Scores are `null` when nothing remains.
 *
 * The frontend mirrors STATS and `score()` in `frontend/src/moneyball/stats.ts`
 * for live preview while editing — keep them in sync.
 */

import { z } from "zod";

export const CATEGORIES = ["offense", "defense", "general"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  offense: "Offense",
  defense: "Defense",
  general: "General",
};

/** Short badge label per category, Madden-style. */
export const CATEGORY_ABBR: Record<Category, string> = {
  offense: "OFF",
  defense: "DEF",
  general: "GEN",
};

export type StatDef = {
  key: StatKey;
  label: string;
  category: Category;
};

export const STAT_KEYS = [
  // Offense
  "short_handling",
  "huck_handling",
  "short_cutting",
  "deep_cutting",
  "decision_making",
  // Defense
  "handler_marking",
  "cutter_marking",
  // General
  "verticality",
  "agility",
  "team_chemistry",
  "effort",
  "game_iq",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

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

export const STAT_BY_KEY: Record<StatKey, StatDef> = Object.fromEntries(
  STATS.map((s) => [s.key, s])
) as Record<StatKey, StatDef>;

export function statsInCategory(category: Category): StatDef[] {
  return STATS.filter((s) => s.category === category);
}

export function isStatKey(value: unknown): value is StatKey {
  return typeof value === "string" && (STAT_KEYS as readonly string[]).includes(value);
}

export const MIN_SCORE = 1;
export const MAX_SCORE = 10;
export const MIN_WEIGHT = 0;
export const MAX_WEIGHT = 5;

/** A single rater's scores. Absent keys mean "not rated". */
export type Scores = Partial<Record<StatKey, number>>;

/** Stat key -> weight in the OVR/category formulas. */
export type Weights = Record<StatKey, number>;

export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(
  STAT_KEYS.map((k) => [k, 1])
) as Weights;

const statKeyEnum = z.enum(STAT_KEYS);

/** Zod schema for one rater's submitted scores (strict: unknown keys rejected). */
export const scoresSchema: z.ZodType<Scores> = z
  .record(statKeyEnum, z.number().int().min(MIN_SCORE).max(MAX_SCORE))
  .refine((r) => Object.keys(r).every(isStatKey), { message: "unknown stat key" });

/** Zod schema for the shared weight table. Every stat must be present. */
export const weightsSchema: z.ZodType<Weights> = z.object(
  Object.fromEntries(
    STAT_KEYS.map((k) => [k, z.number().min(MIN_WEIGHT).max(MAX_WEIGHT)])
  ) as Record<StatKey, z.ZodNumber>
) as unknown as z.ZodType<Weights>;

/**
 * Coerce a stored weights blob (possibly from an older catalog) into a full
 * Weights record: unknown keys dropped, missing keys default to 1.
 */
export function normalizeWeights(input: Record<string, unknown> | null | undefined): Weights {
  const out: Weights = { ...DEFAULT_WEIGHTS };
  if (!input) return out;
  for (const k of STAT_KEYS) {
    const v = input[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, v));
    }
  }
  return out;
}

/** Drop unknown keys and out-of-range values from a stored scores blob. */
export function normalizeScores(input: Record<string, unknown> | null | undefined): Scores {
  const out: Scores = {};
  if (!input) return out;
  for (const k of STAT_KEYS) {
    const v = input[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= MIN_SCORE && v <= MAX_SCORE) {
      out[k] = v;
    }
  }
  return out;
}

export type StatAggregate = {
  /** Mean across raters who scored this stat, or null when nobody has. */
  mean: number | null;
  /** How many raters scored this stat. */
  count: number;
};

export type Aggregate = Record<StatKey, StatAggregate>;

/** Per-stat mean and count across raters. */
export function aggregate(ratings: readonly Scores[]): Aggregate {
  const out = {} as Aggregate;
  for (const k of STAT_KEYS) {
    let sum = 0;
    let n = 0;
    for (const r of ratings) {
      const v = r[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
    out[k] = { mean: n > 0 ? sum / n : null, count: n };
  }
  return out;
}

/** Stat key -> mean (or null). Convenience view of an Aggregate. */
export type StatMeans = Record<StatKey, number | null>;

export function meansOf(agg: Aggregate): StatMeans {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, agg[k].mean])) as StatMeans;
}

/** Scores from a single rater are also a valid StatMeans (unrated -> null). */
export function meansFromScores(scores: Scores): StatMeans {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, scores[k] ?? null])) as StatMeans;
}

export type Scorecard = {
  overall: number | null;
  offense: number | null;
  defense: number | null;
  general: number | null;
};

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Weighted mean of the given stats' means, skipping stats with no data or a
 * zero weight. Null when nothing contributes.
 */
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

/** Overall + per-category scores for one player. */
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

/** Number of distinct raters who scored at least one stat. */
export function raterCount(ratings: readonly Scores[]): number {
  return ratings.filter((r) => STAT_KEYS.some((k) => typeof r[k] === "number")).length;
}
