/**
 * Moneyball stat catalog + scoring, mirrored from backend/src/moneyball/engine.ts
 * so the card can preview OVR live while the user drags sliders. Keep in sync.
 */
import type { Gender } from "./types";

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

export type StatDef = {
  key: StatKey;
  label: string;
  category: Category;
  /** What a rater should be judging. Shown as help text. */
  description: string;
};

/** How to rate: absolute scale across the league, outcomes over mechanics. */
export const RATING_GUIDE: readonly string[] = [
  "These ratings are an absolute scale, regardless of gender. A player with a verticality rating of 8 should be a favorite to sky any player with a rating of 7 or lower, regardless of gender.",
  "Stats should be considered in terms of actual outcomes, not necessarily underlying mechanics. For example, forehand/backhand bias should be considered insofar as it impacts the actual skill: a backhand-dominant player that is still able to effectively throw breakside because of cutting ability, release points, etc. should not be penalized for not having a flick.",
];

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
    description: " Effort",
  },
  {
    key: "game_iq",
    label: "Game IQ",
    category: "general",
    description:
      "Understanding of the state of the game (score/time); ability to identify and exploit strategic and tactical advantages.",
  },
];

export function statsInCategory(category: Category): StatDef[] {
  return STATS.filter((s) => s.category === category);
}

export const MIN_SCORE = 1;
export const MAX_SCORE = 10;
/** Gender colouring shared by the Players and Teams tabs. */
export const GENDER_COLOR: Record<Gender, string> = { M: "#1e88e5", F: "#d81b60" };
export const GENDER_LABEL: Record<Gender, string> = { M: "Man", F: "Woman" };
export const GENDER_ABBR: Record<Gender, string> = { M: "M", F: "W" };
export const UNKNOWN_GENDER_COLOR = "#9e9e9e";
export function genderColor(g: Gender | null | undefined): string {
  return g ? GENDER_COLOR[g] : UNKNOWN_GENDER_COLOR;
}

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
