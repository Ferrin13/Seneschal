import { describe, expect, it } from "vitest";
import {
  computeValuation,
  scoreProjection,
  type EnginePlayerInput,
} from "../src/thrawn/engine.js";

function player(
  partial: Partial<EnginePlayerInput> &
    Pick<EnginePlayerInput, "playerId" | "position" | "basePoints">
): EnginePlayerInput {
  return {
    name: partial.playerId,
    team: null,
    injuryStatus: null,
    age: null,
    overridePoints: null,
    overrideNote: null,
    adp: null,
    rosterId: null,
    ...partial,
  };
}

describe("scoreProjection", () => {
  it("sums stat * points-per-unit over scoring keys only", () => {
    const stats = {
      pass_yd: 4000,
      pass_td: 30,
      pass_int: 10,
      pts_ppr: 999, // not a scoring key; must be ignored
      adp_ppr: 12, // not a scoring key; must be ignored
    };
    const scoring = { pass_yd: 0.04, pass_td: 4, pass_int: -1 };
    expect(scoreProjection(stats, scoring)).toBe(4000 * 0.04 + 30 * 4 - 10);
  });

  it("ignores scoring keys absent from the projection", () => {
    expect(scoreProjection({ rush_yd: 100 }, { rush_yd: 0.1, rec: 1 })).toBe(10);
  });
});

/**
 * Tiny 2-team league: 1 QB, 1 RB, 1 FLEX (RB/WR/TE) per team, 1 keeper each.
 * Player pool crafted so the flex math is easy to verify by hand.
 */
const rosterPositions = ["QB", "RB", "FLEX", "BN"];
const opts = { rosterPositions, numTeams: 2, maxKeepers: 1 };

const pool: EnginePlayerInput[] = [
  player({ playerId: "qb1", position: "QB", basePoints: 300, rosterId: 1 }),
  player({ playerId: "qb2", position: "QB", basePoints: 280, rosterId: 2 }),
  player({ playerId: "qb3", position: "QB", basePoints: 200 }),
  player({ playerId: "rb1", position: "RB", basePoints: 250, rosterId: 1 }),
  player({ playerId: "rb2", position: "RB", basePoints: 240, rosterId: 2 }),
  player({ playerId: "rb3", position: "RB", basePoints: 230, rosterId: 1 }),
  player({ playerId: "rb4", position: "RB", basePoints: 100 }),
  player({ playerId: "wr1", position: "WR", basePoints: 220, rosterId: 2 }),
  player({ playerId: "wr2", position: "WR", basePoints: 120 }),
  player({ playerId: "te1", position: "TE", basePoints: 90, rosterId: 1 }),
];

describe("computeValuation replacement levels", () => {
  const result = computeValuation(pool, opts);
  const repl = Object.fromEntries(result.replacement.map((r) => [r.position, r]));

  it("computes dedicated starter slots from roster positions", () => {
    // 2 teams x 1 QB = 2 QB starters; replacement is qb3 at 200.
    expect(repl.QB!.starterSlots).toBe(2);
    expect(repl.QB!.points).toBe(200);
    expect(repl.QB!.playerId).toBe("qb3");
  });

  it("allocates flex slots greedily to the best remaining players", () => {
    // Dedicated: rb1, rb2 start at RB. Flex pool best remaining: rb3 (230),
    // wr1 (220). Both flex seats go RB then WR.
    expect(repl.RB!.starterSlots).toBe(3); // 2 dedicated + 1 flex
    expect(repl.RB!.points).toBe(100); // rb4 is RB replacement
    expect(repl.WR!.starterSlots).toBe(1); // 1 flex
    expect(repl.WR!.points).toBe(120); // wr2
    // TE never earns a flex seat; replacement is the best TE himself.
    expect(repl.TE!.starterSlots).toBe(0);
    expect(repl.TE!.points).toBe(90);
  });

  it("computes VAR against the position replacement level", () => {
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.qb1!.var).toBe(100); // 300 - 200
    expect(byId.rb1!.var).toBe(150); // 250 - 100
    expect(byId.wr1!.var).toBe(100); // 220 - 120
    expect(byId.te1!.var).toBe(0); // 90 - 90
    expect(byId.rb4!.var).toBe(0); // replacement player himself
  });

  it("ranks players within their position", () => {
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.qb1!.positionRank).toBe(1);
    expect(byId.qb2!.positionRank).toBe(2);
    expect(byId.rb3!.positionRank).toBe(3);
  });
});

describe("computeValuation keeper line", () => {
  it("flags the top maxKeepers*numTeams rostered players by VAR", () => {
    const result = computeValuation(pool, opts);
    // keeperSlots = 1 * 2 = 2. Rostered by VAR: rb1 (150), rb2 (140),
    // qb1 (100), wr1 (100), ...
    expect(result.keeperSlots).toBe(2);
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.rb1!.keeperLevel).toBe(true);
    expect(byId.rb1!.keeperRank).toBe(1);
    expect(byId.rb2!.keeperLevel).toBe(true);
    expect(byId.qb1!.keeperLevel).toBe(false);
    // Free agents never get keeper ranks.
    expect(byId.qb3!.keeperRank).toBeNull();
    expect(result.keeperLineVar).toBe(byId.rb2!.var);
  });
});

describe("computeValuation overrides", () => {
  it("uses override points everywhere: value, ranks, replacement", () => {
    const withOverride = pool.map((p) =>
      p.playerId === "qb2"
        ? { ...p, overridePoints: 320, overrideNote: "breakout" }
        : p
    );
    const result = computeValuation(withOverride, opts);
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.qb2!.points).toBe(320);
    expect(byId.qb2!.basePoints).toBe(280);
    expect(byId.qb2!.overridden).toBe(true);
    expect(byId.qb2!.positionRank).toBe(1);
    expect(byId.qb1!.positionRank).toBe(2);
    expect(byId.qb2!.var).toBe(120); // 320 - 200
  });
});

describe("computeValuation edge cases", () => {
  it("handles positions with fewer players than starter slots", () => {
    const tiny = [
      player({ playerId: "qb1", position: "QB", basePoints: 300, rosterId: 1 }),
    ];
    const result = computeValuation(tiny, opts);
    const repl = result.replacement.find((r) => r.position === "QB")!;
    // Pool exhausted: replacement falls back to the last player available.
    expect(repl.points).toBe(300);
    expect(result.values[0]!.var).toBe(0);
  });

  it("ignores unknown positions", () => {
    const result = computeValuation(
      [
        player({ playerId: "qb1", position: "QB", basePoints: 300 }),
        player({ playerId: "lb1", position: "LB", basePoints: 500 }),
      ],
      opts
    );
    expect(result.values.map((v) => v.playerId)).toEqual(["qb1"]);
  });
});
