import { describe, expect, it } from "vitest";
import {
  aggregate,
  DEFAULT_WEIGHTS,
  meansFromScores,
  meansOf,
  normalizeScores,
  normalizeWeights,
  raterCount,
  score,
  scoresSchema,
  STAT_KEYS,
  STATS,
  statsInCategory,
  weightedMean,
  weightsSchema,
  type Scores,
  type Weights,
} from "../src/moneyball/engine.js";

describe("moneyball stat catalog", () => {
  it("has 12 stats split 5/2/5 across offense/defense/general", () => {
    expect(STATS).toHaveLength(12);
    expect(STAT_KEYS).toHaveLength(12);
    expect(statsInCategory("offense").map((s) => s.key)).toEqual([
      "short_handling",
      "huck_handling",
      "short_cutting",
      "deep_cutting",
      "decision_making",
    ]);
    expect(statsInCategory("defense").map((s) => s.key)).toEqual([
      "handler_marking",
      "cutter_marking",
    ]);
    expect(statsInCategory("general").map((s) => s.key)).toEqual([
      "verticality",
      "agility",
      "team_chemistry",
      "effort",
      "game_iq",
    ]);
  });
});

describe("aggregate", () => {
  it("averages each stat across raters and ignores omitted stats", () => {
    const a: Scores = { short_handling: 8, agility: 6 };
    const b: Scores = { short_handling: 6 };
    const agg = aggregate([a, b]);
    expect(agg.short_handling).toEqual({ mean: 7, count: 2 });
    expect(agg.agility).toEqual({ mean: 6, count: 1 });
    expect(agg.effort).toEqual({ mean: null, count: 0 });
  });

  it("returns all-null with no ratings", () => {
    const agg = aggregate([]);
    for (const k of STAT_KEYS) expect(agg[k]).toEqual({ mean: null, count: 0 });
  });

  it("counts only raters who scored at least one stat", () => {
    expect(raterCount([{ effort: 5 }, {}, { agility: 3 }])).toBe(2);
  });
});

describe("score", () => {
  const full = (v: number): Scores =>
    Object.fromEntries(STAT_KEYS.map((k) => [k, v])) as Scores;

  it("with default weights is the plain mean of rated stats", () => {
    const means = meansFromScores({ ...full(5), effort: 10 });
    const sc = score(means, DEFAULT_WEIGHTS);
    // 11 fives + one ten = 65 / 12
    expect(sc.overall).toBe(5.4);
    expect(sc.offense).toBe(5);
    expect(sc.defense).toBe(5);
    // general: 4 fives + one ten = 30 / 5
    expect(sc.general).toBe(6);
  });

  it("weights stats and drops zero-weight stats", () => {
    const means = meansFromScores({ handler_marking: 10, cutter_marking: 2 });
    const w: Weights = { ...DEFAULT_WEIGHTS, handler_marking: 3, cutter_marking: 1 };
    expect(score(means, w).defense).toBe(8); // (30 + 2) / 4
    const zero: Weights = { ...DEFAULT_WEIGHTS, cutter_marking: 0 };
    expect(score(means, zero).defense).toBe(10);
  });

  it("skips unrated stats and returns null for empty categories", () => {
    const means = meansFromScores({ short_handling: 7, deep_cutting: 8 });
    const sc = score(means, DEFAULT_WEIGHTS);
    expect(sc.offense).toBe(7.5);
    expect(sc.overall).toBe(7.5);
    expect(sc.defense).toBeNull();
    expect(sc.general).toBeNull();
  });

  it("is null when every weight is zero", () => {
    const zero = Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as Weights;
    expect(weightedMean(meansFromScores(full(5)), zero, STAT_KEYS)).toBeNull();
  });

  it("rounds to one decimal", () => {
    const means = meansOf(aggregate([{ effort: 7 }, { effort: 8 }, { effort: 8 }]));
    expect(score(means, DEFAULT_WEIGHTS).general).toBe(7.7);
  });
});

describe("validation and normalization", () => {
  it("accepts partial integer scores 1-10 and rejects junk", () => {
    expect(scoresSchema.parse({ effort: 7 })).toEqual({ effort: 7 });
    expect(scoresSchema.parse({})).toEqual({});
    expect(() => scoresSchema.parse({ effort: 11 })).toThrow();
    expect(() => scoresSchema.parse({ effort: 0 })).toThrow();
    expect(() => scoresSchema.parse({ effort: 7.5 })).toThrow();
    expect(() => scoresSchema.parse({ bogus: 5 })).toThrow();
  });

  it("requires every weight in range", () => {
    expect(weightsSchema.parse(DEFAULT_WEIGHTS)).toEqual(DEFAULT_WEIGHTS);
    expect(() => weightsSchema.parse({ ...DEFAULT_WEIGHTS, effort: 6 })).toThrow();
    const { effort: _e, ...missing } = DEFAULT_WEIGHTS;
    expect(() => weightsSchema.parse(missing)).toThrow();
  });

  it("normalizes stored blobs: unknown keys dropped, missing weights default to 1", () => {
    expect(normalizeWeights({ effort: 2, old_stat: 9 })).toEqual({
      ...DEFAULT_WEIGHTS,
      effort: 2,
    });
    expect(normalizeWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights({ effort: 99 }).effort).toBe(5);
    expect(normalizeScores({ effort: 7, old_stat: 3, agility: 42 })).toEqual({ effort: 7 });
  });
});
