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
  /** What a rater should be judging. Shown as help text in the UI. */
  description: string;
};

/**
 * How to rate, shown alongside the per-stat descriptions. Ratings are an
 * absolute scale across the whole league, and judge outcomes rather than
 * mechanics.
 */
export const RATING_GUIDE: readonly string[] = [
  "These ratings are an absolute scale, regardless of gender. A player with a verticality rating of 8 should be a favorite to sky any player with a rating of 7 or lower, regardless of gender.",
  "Stats should be considered in terms of actual outcomes, not necessarily underlying mechanics. For example, forehand/backhand bias should be considered insofar as it impacts the actual skill: a backhand-dominant player that is still able to effectively throw breakside because of cutting ability, release points, etc. should not be penalized for not having a flick.",
];

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
  {
    key: "short_handling",
    label: "Possession Handling",
    category: "offense",
    description:
      "Ability to execute all non-huck throws. This includes throwing in-cuts, strikes, dumps, swings, etc.",
  },
  {
    key: "huck_handling",
    label: "Huck Handling",
    category: "offense",
    description: "Ability to throw deep hucks.",
  },
  {
    key: "short_cutting",
    label: "Possession Cutting",
    category: "offense",
    description:
      "Ability to cut within the normal flow of an offense. This includes in-cuts, strike cuts, sit-down cuts against zone, etc.",
  },
  {
    key: "deep_cutting",
    label: "Deep Cutting",
    category: "offense",
    description: "Ability to make and catch deep cuts.",
  },
  {
    key: "decision_making",
    label: "Decision Making",
    category: "offense",
    description:
      "As a handler, making good choices on when to throw and when to holster. As a cutter, understanding field space and positioning.",
  },
  {
    key: "handler_marking",
    label: "Handler Marking",
    category: "defense",
    description:
      "Ability to mark on the disc as well as effectively mark and help off of an off-handler. In a zone, ability to play in the cup.",
  },
  {
    key: "cutter_marking",
    label: "Cutter Marking",
    category: "defense",
    description: "Ability to mark a cutter.",
  },
  {
    key: "verticality",
    label: "Verticality",
    category: "general",
    description:
      "Ability to play in the air: a combination of height, leaping ability, and timing.",
  },
  {
    key: "agility",
    label: "Agility",
    category: "general",
    description:
      "Ability to move quickly and change directions quickly. Essentially speed plus quickness.",
  },
  {
    key: "team_chemistry",
    label: "Team Chemistry",
    category: "general",
    description: "Non-playing impact on the team's morale.",
  },
  {
    key: "effort",
    label: "Effort",
    category: "general",
    description: "Effort",
  },
  {
    key: "game_iq",
    label: "Game IQ",
    category: "general",
    description:
      "Understanding of the state of the game (score/time); ability to identify and exploit strategic and tactical advantages.",
  },
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

// ---------------------------------------------------------------------------
// Team summaries
// ---------------------------------------------------------------------------

/** Stats that make a good handler: throwing, decisions, field vision. */
export const HANDLER_STATS: readonly StatKey[] = [
  "short_handling",
  "huck_handling",
  "decision_making",
  "game_iq",
];

/** Stats that make a good cutter: cutting, athleticism. */
export const CUTTER_STATS: readonly StatKey[] = [
  "short_cutting",
  "deep_cutting",
  "verticality",
  "agility",
];

/** Stats that make a good defender: marking plus the athletic/effort stats. */
export const DEFENDER_STATS: readonly StatKey[] = [
  "handler_marking",
  "cutter_marking",
  "agility",
  "verticality",
  "effort",
];

/** Seven on the field; used as the "top of the roster" size for concentration stats. */
export const LINE_SIZE = 7;

export type Gender = "M" | "F";
export const GENDERS: readonly Gender[] = ["M", "F"];

/** Coerce a stored/imported value ("m", "Female", ...) to a Gender, or null. */
export function normalizeGender(v: unknown): Gender | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "m" || s === "male" || s === "man" || s === "men") return "M";
  if (s === "f" || s === "female" || s === "woman" || s === "women") return "F";
  return null;
}

export type RoleScores = {
  handler: number | null;
  cutter: number | null;
  defender: number | null;
};

export function roleScores(means: StatMeans, weights: Weights): RoleScores {
  return {
    handler: weightedMean(means, weights, HANDLER_STATS),
    cutter: weightedMean(means, weights, CUTTER_STATS),
    defender: weightedMean(means, weights, DEFENDER_STATS),
  };
}

/** What the team engine needs to know about one player. */
export type TeamPlayerInput = {
  id: string;
  name: string;
  photoUrl: string | null;
  /** Splits the team rankings; null means unknown. */
  gender: Gender | null;
  /** Team means per stat (null = nobody has rated it). */
  stats: StatMeans;
  raterCount: number;
};

export type RankedPlayer = {
  playerId: string;
  name: string;
  photoUrl: string | null;
  gender: Gender | null;
  scores: Scorecard;
  roles: RoleScores;
  raterCount: number;
};

/** A rostered player nobody has rated yet. */
export type UnratedPlayer = {
  playerId: string;
  name: string;
  photoUrl: string | null;
  gender: Gender | null;
};

/** Top value for one stat and everyone tied at it (rounded means compare equal). */
export type StatLeader = {
  stat: StatKey;
  value: number;
  /** All players sharing the top value, alphabetical. */
  players: { playerId: string; name: string }[];
};

/**
 * How a roster's ability is spread between its top and bottom. All figures
 * are over rated players' OVRs on the 1-10 scale.
 */
export type Concentration = {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  /** max - min. */
  range: number;
  p25: number;
  p75: number;
  /** Population standard deviation. */
  stdDev: number;
  /** Mean OVR of the best LINE_SIZE players (or all, if fewer). */
  topMean: number;
  /** Mean OVR of everyone outside the top LINE_SIZE; null if nobody is. */
  restMean: number | null;
  /** topMean - restMean: how much the starting line outclasses the bench. */
  topGap: number | null;
  /**
   * Gini coefficient of OVR above the floor of the scale (OVR - 1), 0 = every
   * player identical, 1 = one player has it all. Uses OVR - 1 so the bounded
   * scale's floor doesn't hide differences.
   */
  gini: number;
};

function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return sortedAsc[lo]! * (1 - w) + sortedAsc[hi]! * w;
}

export function concentration(
  overalls: readonly number[],
  topSize = LINE_SIZE
): Concentration | null {
  const vals = overalls.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = vals.length;
  if (n === 0) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const desc = [...vals].reverse();
  const top = desc.slice(0, topSize);
  const rest = desc.slice(topSize);
  const topMean = top.reduce((a, b) => a + b, 0) / top.length;
  const restMean = rest.length > 0 ? rest.reduce((a, b) => a + b, 0) / rest.length : null;

  // Gini via the sorted-rank formula on (OVR - MIN_SCORE).
  const shifted = vals.map((v) => v - MIN_SCORE);
  const shiftedSum = shifted.reduce((a, b) => a + b, 0);
  let gini = 0;
  if (shiftedSum > 0 && n > 1) {
    let weighted = 0;
    shifted.forEach((v, i) => {
      weighted += (i + 1) * v;
    });
    gini = (2 * weighted) / (n * shiftedSum) - (n + 1) / n;
  }

  return {
    count: n,
    mean: round1(mean),
    median: round1(percentile(vals, 0.5)),
    min: vals[0]!,
    max: vals[n - 1]!,
    range: round1(vals[n - 1]! - vals[0]!),
    p25: round1(percentile(vals, 0.25)),
    p75: round1(percentile(vals, 0.75)),
    stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
    topMean: round1(topMean),
    restMean: restMean == null ? null : round1(restMean),
    topGap: restMean == null ? null : round1(topMean - restMean),
    gini: Math.round(Math.max(0, gini) * 1000) / 1000,
  };
}

export type TeamSummary = {
  team: string;
  playerCount: number;
  /** Players with at least one rated stat. */
  ratedCount: number;
  /** Spread of rated players' OVRs; null until someone is rated. */
  concentration: Concentration | null;
  /** Mean of player stat means, per stat (null when nobody on the team has it). */
  stats: StatMeans;
  /** Scorecard over the team stat means, i.e. the "average player" on the team. */
  scores: Scorecard;
  /** Every rated player, best OVR first (split by gender client-side). */
  players: RankedPlayer[];
  /** Rostered players with no ratings at all, alphabetical. */
  unrated: UnratedPlayer[];
  /** Best player per stat. */
  leaders: StatLeader[];
};

/** Mean over players of each stat's team mean. */
export function teamStatMeans(players: readonly TeamPlayerInput[]): StatMeans {
  const out = {} as StatMeans;
  for (const k of STAT_KEYS) {
    let sum = 0;
    let n = 0;
    for (const p of players) {
      const v = p.stats[k];
      if (v != null) {
        sum += v;
        n++;
      }
    }
    out[k] = n > 0 ? round1(sum / n) : null;
  }
  return out;
}

export function summarizeTeam(
  team: string,
  players: readonly TeamPlayerInput[],
  weights: Weights
): TeamSummary {
  const isRated = (p: TeamPlayerInput) => STAT_KEYS.some((k) => p.stats[k] != null);
  const rated = players.filter(isRated);
  const unrated: UnratedPlayer[] = players
    .filter((p) => !isRated(p))
    .map((p) => ({ playerId: p.id, name: p.name, photoUrl: p.photoUrl, gender: p.gender }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ranked: RankedPlayer[] = rated
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      photoUrl: p.photoUrl,
      gender: p.gender,
      scores: score(p.stats, weights),
      roles: roleScores(p.stats, weights),
      raterCount: p.raterCount,
    }))
    .sort(
      (a, b) =>
        (b.scores.overall ?? -1) - (a.scores.overall ?? -1) || a.name.localeCompare(b.name)
    );

  const leaders: StatLeader[] = [];
  for (const k of STAT_KEYS) {
    let top: number | null = null;
    for (const p of rated) {
      const v = p.stats[k];
      if (v != null && (top == null || v > top)) top = v;
    }
    if (top == null) continue;
    leaders.push({
      stat: k,
      value: top,
      players: rated
        .filter((p) => p.stats[k] === top)
        .map((p) => ({ playerId: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  const stats = teamStatMeans(rated);
  return {
    team,
    playerCount: players.length,
    ratedCount: rated.length,
    concentration: concentration(
      ranked.map((p) => p.scores.overall).filter((v): v is number => v != null)
    ),
    stats,
    scores: score(stats, weights),
    players: ranked,
    unrated,
    leaders,
  };
}
