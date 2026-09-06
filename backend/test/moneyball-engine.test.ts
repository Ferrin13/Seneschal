import { describe, expect, it } from "vitest";
import {
  aggregate,
  bestDefenseLine,
  bestOffenseLine,
  concentration,
  DEFAULT_WEIGHTS,
  LINE_CUTTERS,
  LINE_HANDLERS,
  summarizeTeam,
  teamStatMeans,
  type TeamPlayerInput,
  meansFromScores,
  meansOf,
  normalizeScores,
  normalizeWeights,
  RATING_GUIDE,
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

  it("gives every stat a rubric description and ships the general guide", () => {
    for (const s of STATS) {
      expect(s.description.trim().length, s.key).toBeGreaterThan(0);
    }
    expect(RATING_GUIDE.length).toBeGreaterThan(0);
    expect(RATING_GUIDE.join(" ")).toMatch(/absolute scale/);
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

/** Build a rated player from a base value plus per-stat overrides. */
function tp(
  id: string,
  base: number | null,
  overrides: Partial<Record<(typeof STAT_KEYS)[number], number | null>> = {}
): TeamPlayerInput {
  const stats = Object.fromEntries(
    STAT_KEYS.map((k) => [k, k in overrides ? overrides[k]! : base])
  ) as TeamPlayerInput["stats"];
  return { id, name: id, photoUrl: null, stats, raterCount: base == null ? 0 : 1 };
}

describe("team lines", () => {
  const W = DEFAULT_WEIGHTS;

  it("fills 4 handler + 3 cutter slots from distinct players, best role scores first", () => {
    const handlers = ["h1", "h2", "h3", "h4"].map((id, i) =>
      tp(id, 5, { short_handling: 9 - i, huck_handling: 9, decision_making: 9, game_iq: 9 })
    );
    const cutters = ["c1", "c2", "c3"].map((id, i) =>
      tp(id, 5, { short_cutting: 9 - i, deep_cutting: 9, verticality: 9, agility: 9 })
    );
    const bench = [tp("b1", 3), tp("b2", 4)];
    const line = bestOffenseLine([...bench, ...cutters, ...handlers], W);
    expect(line.short).toBe(false);
    expect(line.slots).toHaveLength(LINE_HANDLERS + LINE_CUTTERS);
    expect(line.slots.filter((s) => s.role === "handler").map((s) => s.playerId)).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
    ]);
    expect(line.slots.filter((s) => s.role === "cutter").map((s) => s.playerId)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    expect(new Set(line.slots.map((s) => s.playerId)).size).toBe(7);
  });

  it("puts a two-way star where the team gains most, not where they rank highest", () => {
    // Star is the best handler AND the best cutter. Four other solid handlers
    // exist but only two other cutters, so the star must cut.
    const star = tp("star", 5, {
      short_handling: 10,
      huck_handling: 10,
      decision_making: 10,
      game_iq: 10,
      short_cutting: 10,
      deep_cutting: 10,
      verticality: 10,
      agility: 10,
    });
    const handlers = ["h1", "h2", "h3", "h4"].map((id) =>
      tp(id, 2, { short_handling: 8, huck_handling: 8, decision_making: 8, game_iq: 8 })
    );
    const cutters = ["c1", "c2"].map((id) =>
      tp(id, 2, { short_cutting: 8, deep_cutting: 8, verticality: 8, agility: 8 })
    );
    const line = bestOffenseLine([...handlers, star, ...cutters], W);
    const starSlot = line.slots.find((s) => s.playerId === "star");
    expect(starSlot?.role).toBe("cutter");
    expect(line.short).toBe(false);
  });

  it("returns a short line when there aren't enough rated players", () => {
    const line = bestOffenseLine([tp("a", 6), tp("b", 7), tp("x", null)], W);
    expect(line.short).toBe(true);
    expect(line.slots).toHaveLength(2);
    expect(line.slots.map((s) => s.playerId).sort()).toEqual(["a", "b"]);
  });

  it("respects zero weights when scoring roles", () => {
    const w = { ...W, short_handling: 0, huck_handling: 0, decision_making: 0, game_iq: 0 };
    const line = bestOffenseLine([tp("a", 6)], w);
    // Handler score is null for everyone, so only a cutter slot can be filled.
    expect(line.slots).toEqual([expect.objectContaining({ playerId: "a", role: "cutter" })]);
  });

  it("picks the defensive line by defender score", () => {
    const players = Array.from({ length: 10 }, (_, i) =>
      tp(`p${i}`, 5, { handler_marking: i + 1, cutter_marking: i + 1 })
    );
    const line = bestDefenseLine(players, W);
    expect(line.slots.map((s) => s.playerId)).toEqual(["p9", "p8", "p7", "p6", "p5", "p4", "p3"]);
    expect(line.short).toBe(false);
  });
});

describe("summarizeTeam", () => {
  it("averages stats across rated players and ranks by OVR", () => {
    const players = [tp("a", 8), tp("b", 6), tp("c", null), tp("d", 7, { effort: null })];
    const s = summarizeTeam("Team", players, DEFAULT_WEIGHTS);
    expect(s.playerCount).toBe(4);
    expect(s.ratedCount).toBe(3);
    expect(s.stats.agility).toBe(7); // (8 + 6 + 7) / 3
    expect(s.stats.effort).toBe(7); // (8 + 6) / 2, d skipped
    expect(s.players.map((p) => p.playerId)).toEqual(["a", "d", "b"]);
    expect(s.bestPlayers[0]?.scores.overall).toBe(8);
    expect(s.leaders.find((l) => l.stat === "agility")).toEqual({
      stat: "agility",
      playerId: "a",
      name: "a",
      value: 8,
    });
    expect(s.offenseLine.short).toBe(true);
  });

  it("is all-null for a team with no ratings", () => {
    const s = summarizeTeam("Empty", [tp("a", null)], DEFAULT_WEIGHTS);
    expect(s.ratedCount).toBe(0);
    expect(s.scores.overall).toBeNull();
    expect(s.leaders).toEqual([]);
    expect(s.offenseLine.slots).toEqual([]);
    expect(teamStatMeans([]).effort).toBeNull();
  });
});

describe("concentration", () => {
  it("is null with no rated players", () => {
    expect(concentration([])).toBeNull();
  });

  it("is flat for identical players", () => {
    const c = concentration([6, 6, 6, 6, 6, 6, 6, 6, 6])!;
    expect(c.range).toBe(0);
    expect(c.stdDev).toBe(0);
    expect(c.gini).toBe(0);
    expect(c.topMean).toBe(6);
    expect(c.restMean).toBe(6);
    expect(c.topGap).toBe(0);
  });

  it("measures top-7 vs bench gap and spread", () => {
    // Seven 9s and three 3s.
    const c = concentration([9, 9, 9, 9, 9, 9, 9, 3, 3, 3])!;
    expect(c.count).toBe(10);
    expect(c.min).toBe(3);
    expect(c.max).toBe(9);
    expect(c.range).toBe(6);
    expect(c.topMean).toBe(9);
    expect(c.restMean).toBe(3);
    expect(c.topGap).toBe(6);
    expect(c.mean).toBe(7.2);
    expect(c.median).toBe(9);
    expect(c.p25).toBe(4.5);
    expect(c.stdDev).toBeCloseTo(2.75, 2);
    expect(c.gini).toBeGreaterThan(0.1);
  });

  it("ranks a top-heavy roster as more concentrated than a balanced one", () => {
    const balanced = concentration([7, 7, 6, 6, 6, 6, 5, 5])!;
    const topHeavy = concentration([10, 10, 3, 3, 3, 3, 3, 3])!;
    expect(topHeavy.gini).toBeGreaterThan(balanced.gini);
    expect(topHeavy.stdDev).toBeGreaterThan(balanced.stdDev);
  });

  it("has no bench figures when the roster fits in one line", () => {
    const c = concentration([8, 7, 6])!;
    expect(c.topMean).toBe(7);
    expect(c.restMean).toBeNull();
    expect(c.topGap).toBeNull();
  });

  it("is attached to team summaries", () => {
    const s = summarizeTeam("T", [tp("a", 8), tp("b", 4), tp("c", null)], DEFAULT_WEIGHTS);
    expect(s.concentration?.count).toBe(2);
    expect(s.concentration?.range).toBe(4);
    expect(summarizeTeam("E", [tp("x", null)], DEFAULT_WEIGHTS).concentration).toBeNull();
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
