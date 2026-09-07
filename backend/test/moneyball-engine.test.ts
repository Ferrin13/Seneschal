import { describe, expect, it } from "vitest";
import {
  aggregate,
  concentration,
  CUTTER_STATS,
  DEFAULT_ROLE_WEIGHTS,
  DEFAULT_WEIGHTS,
  HANDLER_STATS,
  normalizeRoleWeights,
  ROLES,
  roleScores,
  roleWeightsSchema,
  summarizeTeam,
  teamStatMeans,
  type Gender,
  type RoleWeights,
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
  overrides: Partial<Record<(typeof STAT_KEYS)[number], number | null>> = {},
  gender: Gender | null = "M"
): TeamPlayerInput {
  const stats = Object.fromEntries(
    STAT_KEYS.map((k) => [k, k in overrides ? overrides[k]! : base])
  ) as TeamPlayerInput["stats"];
  return { id, name: id, photoUrl: null, gender, stats, raterCount: base == null ? 0 : 1 };
}
/** Female variant of tp. */
const tpF = (
  id: string,
  base: number | null,
  overrides: Partial<Record<(typeof STAT_KEYS)[number], number | null>> = {}
) => tp(id, base, overrides, "F");

describe("summarizeTeam", () => {
  it("averages stats across rated players and ranks by OVR", () => {
    const players = [tp("a", 8), tp("b", 6), tp("c", null), tp("d", 7, { effort: null })];
    const s = summarizeTeam("Team", players, DEFAULT_WEIGHTS);
    expect(s.playerCount).toBe(4);
    expect(s.ratedCount).toBe(3);
    expect(s.stats.agility).toBe(7); // (8 + 6 + 7) / 3
    expect(s.stats.effort).toBe(7); // (8 + 6) / 2, d skipped
    expect(s.players.map((p) => p.playerId)).toEqual(["a", "d", "b"]);
    expect(s.players[0]?.scores.overall).toBe(8);
    expect(s.unrated).toEqual([{ playerId: "c", name: "c", photoUrl: null, gender: "M" }]);
    expect(s.leaders.find((l) => l.stat === "agility")).toEqual({
      stat: "agility",
      value: 8,
      players: [{ playerId: "a", name: "a" }],
    });
  });

  it("carries gender through so the client can split the rankings", () => {
    const players = [tp("m", 7), tpF("w", 9), tp("u", 5, {}, null), tpF("wx", null)];
    const s = summarizeTeam("Team", players, DEFAULT_WEIGHTS);
    expect(s.players.map((p) => [p.playerId, p.gender])).toEqual([
      ["w", "F"],
      ["m", "M"],
      ["u", null],
    ]);
    expect(s.unrated.map((p) => [p.playerId, p.gender])).toEqual([["wx", "F"]]);
  });

  it("lists every player tied for a stat lead", () => {
    const players = [tp("zed", 6, { effort: 9 }), tp("amy", 5, { effort: 9 }), tp("bob", 7)];
    const s = summarizeTeam("Team", players, DEFAULT_WEIGHTS);
    expect(s.leaders.find((l) => l.stat === "effort")).toEqual({
      stat: "effort",
      value: 9,
      players: [
        { playerId: "amy", name: "amy" },
        { playerId: "zed", name: "zed" },
      ],
    });
    expect(s.leaders.find((l) => l.stat === "agility")?.players).toEqual([
      { playerId: "bob", name: "bob" },
    ]);
  });

  it("is all-null for a team with no ratings", () => {
    const s = summarizeTeam("Empty", [tp("a", null)], DEFAULT_WEIGHTS);
    expect(s.ratedCount).toBe(0);
    expect(s.scores.overall).toBeNull();
    expect(s.leaders).toEqual([]);
    expect(s.players).toEqual([]);
    expect(s.unrated.map((p) => p.playerId)).toEqual(["a"]);
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

describe("roleScores", () => {
  const full = (v: number): Scores =>
    Object.fromEntries(STAT_KEYS.map((k) => [k, v])) as Scores;

  it("with default role weights matches the historical fixed stat sets", () => {
    const means = meansFromScores({ ...full(5), short_handling: 9, deep_cutting: 9 });
    const roles = roleScores(means, DEFAULT_ROLE_WEIGHTS);
    // Handler: 9 + three 5s = 24/4; cutter: 9 + three 5s = 24/4.
    expect(roles.handler).toBe(6);
    expect(roles.cutter).toBe(6);
    expect(roles.defender).toBe(5);
    expect(roles.handler).toBe(weightedMean(means, DEFAULT_WEIGHTS, HANDLER_STATS));
    expect(roles.cutter).toBe(weightedMean(means, DEFAULT_WEIGHTS, CUTTER_STATS));
  });

  it("lets any stat feed any role via its weight table", () => {
    // Effort isn't in the default handler set; weight it in and it counts.
    const rw: RoleWeights = {
      ...DEFAULT_ROLE_WEIGHTS,
      handler: { ...DEFAULT_ROLE_WEIGHTS.handler, effort: 4, short_handling: 0 },
    };
    const means = meansFromScores({ ...full(5), effort: 10, short_handling: 10 });
    const roles = roleScores(means, rw);
    // 10*4 (effort) + 5*3 (huck/decision/iq) = 55 / 7; the zero-weight
    // short_handling 10 is dropped entirely.
    expect(roles.handler).toBe(7.9);
    // Other roles keep their defaults.
    expect(roles.cutter).toBe(5);
  });

  it("is null for a role whose weighted stats are all unrated", () => {
    const means = meansFromScores({ handler_marking: 8 });
    const roles = roleScores(means, DEFAULT_ROLE_WEIGHTS);
    expect(roles.handler).toBeNull();
    expect(roles.defender).toBe(8);
  });

  it("flows editable role weights through team summaries", () => {
    const stats = meansFromScores({ ...full(5), effort: 10 });
    const player: TeamPlayerInput = {
      id: "a",
      name: "a",
      photoUrl: null,
      gender: "M",
      stats,
      raterCount: 1,
    };
    const rw: RoleWeights = {
      ...DEFAULT_ROLE_WEIGHTS,
      cutter: { ...DEFAULT_ROLE_WEIGHTS.cutter, effort: 4 },
    };
    const s = summarizeTeam("Team", [player], DEFAULT_WEIGHTS, rw);
    // 4 fives + effort 10*4 = 60 / 8.
    expect(s.players[0]?.roles.cutter).toBe(7.5);
    // Default when the tables aren't passed (back-compat).
    const d = summarizeTeam("Team", [player], DEFAULT_WEIGHTS);
    expect(d.players[0]?.roles.cutter).toBe(5);
  });
});

describe("role weight normalization and validation", () => {
  it("falls back to each role's own defaults, not 1, for missing entries", () => {
    const rw = normalizeRoleWeights({ handler: { effort: 3 } });
    // Provided key applies...
    expect(rw.handler.effort).toBe(3);
    // ...missing keys keep the role's default (short_cutting is NOT a handler stat).
    expect(rw.handler.short_handling).toBe(1);
    expect(rw.handler.short_cutting).toBe(0);
    // Whole missing roles come back as their defaults.
    expect(rw.cutter).toEqual(DEFAULT_ROLE_WEIGHTS.cutter);
    expect(normalizeRoleWeights(null)).toEqual(DEFAULT_ROLE_WEIGHTS);
  });

  it("clamps out-of-range stored values", () => {
    expect(normalizeRoleWeights({ defender: { effort: 99 } }).defender.effort).toBe(5);
    expect(normalizeRoleWeights({ defender: { effort: -2 } }).defender.effort).toBe(0);
  });

  it("requires every role and stat in the schema", () => {
    expect(roleWeightsSchema.safeParse(DEFAULT_ROLE_WEIGHTS).success).toBe(true);
    const missingRole = { handler: DEFAULT_ROLE_WEIGHTS.handler, cutter: DEFAULT_ROLE_WEIGHTS.cutter };
    expect(roleWeightsSchema.safeParse(missingRole).success).toBe(false);
    const badWeight = {
      ...DEFAULT_ROLE_WEIGHTS,
      handler: { ...DEFAULT_ROLE_WEIGHTS.handler, effort: 9 },
    };
    expect(roleWeightsSchema.safeParse(badWeight).success).toBe(false);
    expect(ROLES).toEqual(["handler", "cutter", "defender"]);
  });
});
