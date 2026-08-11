import { describe, expect, it } from "vitest";
import {
  computeRegression,
  computeSeasonLuck,
  computeValuation,
  positionCountsFromAdp,
  positionCountsFromRosters,
  replacementLevels,
  scoreProjection,
  type EnginePlayerInput,
  type SeasonHistoryInput,
  type SeasonMatchupRow,
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
    gamesProj: 10, // ppg = basePoints / 10 for easy mental math
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
 * Tiny 2-team league: 1 QB, 1 RB, 1 FLEX (RB/WR/TE), 1 BN per team.
 * gamesProj is 10 for everyone, so ppg = basePoints / 10.
 *
 * Roster simulation walk-through:
 *  - Dedicated: qb1, qb2 (QB); rb1, rb2 (RB).
 *  - Flex (2 seats, best raw ppg): rb3 (23), then wr1 (22).
 *  - Starter baselines afterwards: QB qb3 (20), RB rb4 (18), WR wr2 (12),
 *    TE te1 (9).
 *  - Bench (2 seats, value over baseline; all next players tie at 0, so raw
 *    ppg breaks ties): qb3 (20), then rb4 (18).
 *  - Replacement: QB qb4 (15, rank 4), RB rb5 (10, rank 5), WR wr2 (12,
 *    rank 2), TE te1 (9, rank 1 — pool exhausted, falls back to himself).
 */
const rosterPositions = ["QB", "RB", "FLEX", "BN"];
const opts = { rosterPositions, numTeams: 2, maxKeepers: 1 };

const pool: EnginePlayerInput[] = [
  player({ playerId: "qb1", position: "QB", basePoints: 300, rosterId: 1 }),
  player({ playerId: "qb2", position: "QB", basePoints: 280, rosterId: 2 }),
  player({ playerId: "qb3", position: "QB", basePoints: 200 }),
  player({ playerId: "qb4", position: "QB", basePoints: 150 }),
  player({ playerId: "rb1", position: "RB", basePoints: 260, rosterId: 1 }),
  player({ playerId: "rb2", position: "RB", basePoints: 240, rosterId: 2 }),
  player({ playerId: "rb3", position: "RB", basePoints: 230, rosterId: 1 }),
  player({ playerId: "rb4", position: "RB", basePoints: 180 }),
  player({ playerId: "rb5", position: "RB", basePoints: 100 }),
  player({ playerId: "wr1", position: "WR", basePoints: 220, rosterId: 2 }),
  player({ playerId: "wr2", position: "WR", basePoints: 120 }),
  player({ playerId: "wr3", position: "WR", basePoints: 60 }),
  player({ playerId: "te1", position: "TE", basePoints: 90, rosterId: 1 }),
];

describe("fringe-bench replacement levels", () => {
  const result = computeValuation(pool, opts);
  const repl = Object.fromEntries(result.replacement.map((r) => [r.position, r]));

  it("places replacement past starters AND bench, not at fringe starter", () => {
    // Fringe starter at QB would be qb3 (20/g); fringe bench pushes one
    // deeper because a bench seat swallows qb3.
    expect(repl.QB!.ppg).toBe(15);
    expect(repl.QB!.playerId).toBe("qb4");
    expect(repl.QB!.rank).toBe(4);
    // RB: 2 dedicated + 1 flex + 1 bench seat -> replacement is rb5.
    expect(repl.RB!.ppg).toBe(10);
    expect(repl.RB!.playerId).toBe("rb5");
    expect(repl.RB!.rank).toBe(5);
  });

  it("does not spend bench seats on negative-value positions", () => {
    // wr2 ties the WR baseline (value 0) but loses the raw-ppg tie-breaks,
    // so WR gets no bench seat and wr2 himself is the replacement.
    expect(repl.WR!.ppg).toBe(12);
    expect(repl.WR!.playerId).toBe("wr2");
  });

  it("falls back to the last player when a pool is exhausted", () => {
    expect(repl.TE!.ppg).toBe(9);
    expect(repl.TE!.playerId).toBe("te1");
    expect(repl.TE!.rank).toBe(1);
  });

  it("computes per-game PAR against the fringe-bench baseline", () => {
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.qb1!.ppg).toBe(30);
    expect(byId.qb1!.par).toBe(15); // 30 - 15
    expect(byId.rb1!.par).toBe(16); // 26 - 10
    expect(byId.wr1!.par).toBe(10); // 22 - 12
    expect(byId.te1!.par).toBe(0); // fallback replacement is himself
    expect(byId.rb5!.par).toBe(0); // the replacement player himself
  });

  it("computes the league-average starter baseline (median starter, flex-aware)", () => {
    // QB: 2 starters -> median of qb1 (30) and qb2 (28) = 29.
    expect(repl.QB!.starterCount).toBe(2);
    expect(repl.QB!.avgStarterPpg).toBe(29);
    // RB: 2 dedicated + 1 flex seat = 3 starters -> median is rb2 (24).
    expect(repl.RB!.starterCount).toBe(3);
    expect(repl.RB!.avgStarterPpg).toBe(24);
    // WR: only the flex seat wr1 took -> median is wr1 himself (22).
    expect(repl.WR!.starterCount).toBe(1);
    expect(repl.WR!.avgStarterPpg).toBe(22);
    // TE: no starters anywhere -> falls back to the best TE.
    expect(repl.TE!.starterCount).toBe(0);
    expect(repl.TE!.avgStarterPpg).toBe(9);
  });

  it("computes PAR vs. the average starter alongside PAR vs. fringe bench", () => {
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.qb1!.parStarter).toBe(1); // 30 - 29
    expect(byId.qb2!.parStarter).toBe(-1); // 28 - 29
    expect(byId.rb1!.parStarter).toBe(2); // 26 - 24
    expect(byId.wr2!.parStarter).toBe(-10); // 12 - 22
  });

  it("is independent of who is rostered vs. on waivers", () => {
    const allFreeAgents = pool.map((p) => ({ ...p, rosterId: null }));
    const fa = computeValuation(allFreeAgents, opts);
    const faRepl = Object.fromEntries(fa.replacement.map((r) => [r.position, r]));
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      expect(faRepl[pos]!.ppg).toBe(repl[pos]!.ppg);
      expect(faRepl[pos]!.playerId).toBe(repl[pos]!.playerId);
    }
  });

  it("respects gamesProj as the per-game denominator", () => {
    const result = computeValuation(
      [
        player({ playerId: "a", position: "QB", basePoints: 100, gamesProj: 5, rosterId: 1 }),
        player({ playerId: "b", position: "QB", basePoints: 100, gamesProj: 10 }),
      ],
      opts
    );
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.a!.ppg).toBe(20);
    expect(byId.b!.ppg).toBe(10);
  });
});

describe("replacementLevels bench allocation", () => {
  it("gives bench seats to positive-value depth over higher raw scorers", () => {
    // QB depth is worthless (qbB far below baseline qbB? no—see below), while
    // RB depth holds value. One bench seat must go RB, not QB, even though
    // the QB scores more raw points.
    const players = [
      { playerId: "qbA", name: "qbA", position: "QB", ppg: 30 },
      { playerId: "qbB", name: "qbB", position: "QB", ppg: 29 },
      { playerId: "qbC", name: "qbC", position: "QB", ppg: 28 }, // baseline QB
      { playerId: "qbD", name: "qbD", position: "QB", ppg: 14 },
      { playerId: "rbA", name: "rbA", position: "RB", ppg: 20 },
      { playerId: "rbB", name: "rbB", position: "RB", ppg: 19 },
      { playerId: "rbC", name: "rbC", position: "RB", ppg: 18 },
      { playerId: "rbD", name: "rbD", position: "RB", ppg: 17 }, // baseline RB
      { playerId: "rbE", name: "rbE", position: "RB", ppg: 16 },
      { playerId: "rbF", name: "rbF", position: "RB", ppg: 5 },
    ];
    // 2 teams x (QB, RB, BN): starters qbA/qbB + rbA/rbB; no flex.
    // Baselines: QB qbC (28), RB rbC (18).
    // Bench seats (2): qbC value 0 vs rbC value 0 -> raw ppg tie-break picks
    // qbC (28); next seat: qbD value 14-28=-14 vs rbC value 0 -> rbC.
    const repl = replacementLevels(players, ["QB", "RB", "BN"], 2);
    expect(repl.get("QB")!.playerId).toBe("qbD");
    expect(repl.get("RB")!.playerId).toBe("rbD");
    // rbD's value over baseline: rbD IS the next after rbC was benched.
    expect(repl.get("RB")!.ppg).toBe(17);
  });

  it("consumes to ADP-derived counts when provided, floored at starters", () => {
    const players = [
      { playerId: "qbA", name: "qbA", position: "QB", ppg: 30 },
      { playerId: "qbB", name: "qbB", position: "QB", ppg: 29 },
      { playerId: "qbC", name: "qbC", position: "QB", ppg: 28 },
      { playerId: "rbA", name: "rbA", position: "RB", ppg: 20 },
      { playerId: "rbB", name: "rbB", position: "RB", ppg: 19 },
      { playerId: "rbC", name: "rbC", position: "RB", ppg: 18 },
      { playerId: "rbD", name: "rbD", position: "RB", ppg: 17 },
      { playerId: "rbE", name: "rbE", position: "RB", ppg: 16 },
    ];
    // ADP says the league rosters 2 QBs (exactly the starters) and 4 RBs
    // (two bench seats beyond the starters).
    const counts = new Map([
      ["QB", 2],
      ["RB", 4],
    ]);
    const repl = replacementLevels(players, ["QB", "RB", "BN"], 2, counts);
    // QB: 2 starters consumed, count 2 adds nothing -> replacement is qbC.
    expect(repl.get("QB")!.playerId).toBe("qbC");
    // RB: 2 starters, count pushes to 4 -> replacement is rbE.
    expect(repl.get("RB")!.playerId).toBe("rbE");
    // Starters floor: a count lower than seated starters must not shrink.
    const low = replacementLevels(
      players,
      ["QB", "RB", "BN"],
      2,
      new Map([["QB", 1]])
    );
    expect(low.get("QB")!.playerId).toBe("qbC");
  });
});

describe("computeRegression", () => {
  const scoring = { rec_td: 6, rec_yd: 0.1, rec: 1, pass_td: 4, pass_yd: 0.04, rush_td: 6, rush_yd: 0.1 };

  it("flags TD over/under-performers vs cohort volume expectation", () => {
    // Five WRs, identical volume/yards/receptions; only TDs differ. With no
    // red-zone data the model falls back to the aggregate TD-per-target
    // rate: (10+2+6+6+6)/500 = 0.06 -> 6 expected TDs each.
    const wr = (id: string, td: number) => ({
      playerId: id,
      name: id,
      position: "WR",
      gp: 10,
      stats: { rec_tgt: 100, rec_td: td, rec_yd: 800, rec: 60 },
    });
    const rows = computeRegression(
      [wr("hot", 10), wr("cold", 2), wr("a", 6), wr("b", 6), wr("c", 6)],
      scoring
    );
    const byId = Object.fromEntries(rows.map((r) => [r.playerId, r]));
    // Yards and receptions match expectation exactly, so the delta is pure
    // TD luck: (10-6)*6 = +24 pts -> +2.4/g; cold is the mirror image.
    expect(byId.hot!.deltaPts).toBeCloseTo(24, 1);
    expect(byId.hot!.deltaPtsPerGame).toBeCloseTo(2.4, 1);
    expect(byId.cold!.deltaPts).toBeCloseTo(-24, 1);
    expect(byId.a!.deltaPts).toBeCloseTo(0, 1);
    // Sorted hottest first.
    expect(rows[0]!.playerId).toBe("hot");
    expect(rows[rows.length - 1]!.playerId).toBe("cold");
  });

  it("recovers separate red-zone and field TD rates when data supports it", () => {
    // Six RBs whose TDs follow exactly td = 0.02*(att-rz) + 0.25*rz, with
    // varying red-zone shares so the two-rate fit is well-conditioned.
    const rb = (id: string, att: number, rz: number) => ({
      playerId: id,
      name: id,
      position: "RB",
      gp: 17,
      stats: {
        rush_att: att,
        rush_rz_att: rz,
        rush_td: 0.02 * (att - rz) + 0.25 * rz,
        rush_yd: att * 4.2,
      },
    });
    const rows = computeRegression(
      [
        rb("r1", 300, 60),
        rb("r2", 250, 20),
        rb("r3", 200, 40),
        rb("r4", 150, 10),
        rb("r5", 100, 30),
        rb("r6", 120, 5),
      ],
      scoring
    );
    // Perfect linear data -> every player's expected TDs equal actuals.
    for (const r of rows) {
      const rush = r.phases.find((p) => p.phase === "rush")!;
      expect(rush.expTd).toBeCloseTo(rush.actualTd, 1);
      expect(r.deltaPts).toBeCloseTo(0, 1);
    }
  });

  it("evaluates both pass and rush phases for QBs above volume minimums", () => {
    const qb = (id: string, passTd: number) => ({
      playerId: id,
      name: id,
      position: "QB",
      gp: 17,
      stats: {
        pass_att: 500,
        pass_td: passTd,
        pass_yd: 4000,
        rush_att: 50,
        rush_td: 3,
        rush_yd: 250,
      },
    });
    const rows = computeRegression(
      [qb("q1", 40), qb("q2", 20), qb("q3", 30), qb("q4", 30), qb("q5", 30)],
      scoring
    );
    const q1 = rows.find((r) => r.playerId === "q1")!;
    expect(q1.phases.map((p) => p.phase).sort()).toEqual(["pass", "rush"]);
    // Aggregate pass TD rate = 150/2500 = 0.06 -> 30 expected; q1 threw 40.
    expect(q1.phases.find((p) => p.phase === "pass")!.expTd).toBeCloseTo(30, 1);
    expect(q1.deltaPts).toBeCloseTo(40, 1); // (40-30)*4 pass-td points
  });

  it("skips players below the volume floor", () => {
    const rows = computeRegression(
      [
        {
          playerId: "deep",
          name: "deep",
          position: "WR",
          gp: 8,
          stats: { rec_tgt: 10, rec_td: 3, rec_yd: 200, rec: 8 },
        },
      ],
      scoring
    );
    expect(rows).toHaveLength(0);
  });
});

describe("positionCountsFromRosters", () => {
  it("counts base positions on actual rosters", () => {
    const rostered = [
      { position: "RB" },
      { position: "RB" },
      { position: "WR" },
      { position: "TE" },
      { position: "LB" }, // non-fantasy position: ignored
    ];
    const counts = positionCountsFromRosters(rostered, 4)!;
    expect(counts.get("RB")).toBe(2);
    expect(counts.get("WR")).toBe(1);
    expect(counts.get("TE")).toBe(1);
    expect(counts.has("LB")).toBe(false);
  });

  it("returns null when rosters are too sparse (pre-draft stubs)", () => {
    expect(
      positionCountsFromRosters([{ position: "RB" }], 10)
    ).toBeNull();
  });
});

describe("positionCountsFromAdp", () => {
  it("counts positions over a full draft's worth of the best ADPs", () => {
    const players = [
      { position: "RB", adp: 1 },
      { position: "WR", adp: 2 },
      { position: "RB", adp: 3 },
      { position: "QB", adp: 4 },
      { position: "TE", adp: 5 },
      { position: "RB", adp: 6 },
      { position: "WR", adp: null }, // undrafted: ignored
    ];
    const counts = positionCountsFromAdp(players, 4)!;
    expect(counts.get("RB")).toBe(2);
    expect(counts.get("WR")).toBe(1);
    expect(counts.get("QB")).toBe(1);
    expect(counts.get("TE")).toBeUndefined();
  });

  it("returns null when ADP coverage is too thin to trust", () => {
    expect(
      positionCountsFromAdp([{ position: "RB", adp: 1 }], 10)
    ).toBeNull();
  });
});

describe("historical PAR and variance", () => {
  // Two past seasons. qb1 plays both; te1 never appears.
  const history: SeasonHistoryInput[] = [
    {
      season: "2025",
      players: [
        { playerId: "qb1", position: "QB", points: 320, gp: 16 }, // 20 ppg
        { playerId: "qb2", position: "QB", points: 240, gp: 16 }, // 15 ppg
        { playerId: "qb3", position: "QB", points: 160, gp: 16 }, // 10 ppg
        { playerId: "rb1", position: "RB", points: 160, gp: 16 },
        { playerId: "rb2", position: "RB", points: 144, gp: 16 },
        { playerId: "rb3", position: "RB", points: 128, gp: 16 },
        { playerId: "rb4", position: "RB", points: 80, gp: 16 },
        { playerId: "wr1", position: "WR", points: 96, gp: 16 },
        { playerId: "wr2", position: "WR", points: 64, gp: 16 },
      ],
    },
    {
      season: "2024",
      players: [
        { playerId: "qb1", position: "QB", points: 140, gp: 10 }, // 14 ppg
        { playerId: "qb2", position: "QB", points: 170, gp: 17 }, // 10 ppg
        { playerId: "qb3", position: "QB", points: 68, gp: 17 }, // 4 ppg
        { playerId: "rb1", position: "RB", points: 170, gp: 17 },
        { playerId: "rb2", position: "RB", points: 153, gp: 17 },
        { playerId: "rb3", position: "RB", points: 136, gp: 17 },
        { playerId: "rb4", position: "RB", points: 85, gp: 17 },
        { playerId: "wr1", position: "WR", points: 102, gp: 17 },
        { playerId: "wr2", position: "WR", points: 68, gp: 17 },
      ],
    },
  ];

  const result = computeValuation(pool, { ...opts, history });
  const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));

  it("prices each season with the same fringe-bench simulation", () => {
    // Both seasons: QB pool of 3 is exhausted by starters+bench, so the QB
    // replacement falls back to qb3 (10 ppg in 2025, 4 ppg in 2024).
    // PAS baselines on the median starter (2 QB starters -> qb1/qb2 mean).
    // posRank is the season-total finish: qb1's 140 pts in 2024 trail qb2's
    // 170 despite the better ppg, so he finished QB2 that year.
    expect(byId.qb1!.history).toEqual([
      { season: "2025", gp: 16, ppg: 20, par: 10, pas: 2.5, posRank: 1 },
      { season: "2024", gp: 10, ppg: 14, par: 10, pas: 2, posRank: 2 },
    ]);
  });

  it("orders history newest first and includes only seasons played", () => {
    expect(byId.qb1!.history.map((h) => h.season)).toEqual(["2025", "2024"]);
    expect(byId.te1!.history).toEqual([]);
    expect(byId.te1!.parVariance).toBeNull();
  });

  it("computes population variance of historical PARs", () => {
    // qb1: vars [10, 10] -> variance 0.
    expect(byId.qb1!.parVariance).toBe(0);
    // qb2: 2025 var = 15-10 = 5; 2024 var = 10-4 = 6 -> variance 0.25.
    expect(byId.qb2!.parVariance).toBe(0.25);
  });

  it("requires at least two seasons for a variance", () => {
    const oneSeason = computeValuation(pool, {
      ...opts,
      history: [history[0]!],
    });
    const one = Object.fromEntries(oneSeason.values.map((v) => [v.playerId, v]));
    expect(one.qb1!.history).toHaveLength(1);
    expect(one.qb1!.parVariance).toBeNull();
  });
});

describe("keeper line", () => {
  it("flags the top maxKeepers*numTeams rostered players by per-game PAS", () => {
    const result = computeValuation(pool, opts);
    // keeperSlots = 1 * 2 = 2. Eligible rostered by PAS: rb1 (+2), qb1 (+1), ...
    expect(result.keeperSlots).toBe(2);
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.rb1!.keeperLevel).toBe(true);
    expect(byId.rb1!.keeperRank).toBe(1);
    expect(byId.qb1!.keeperLevel).toBe(true);
    expect(byId.qb1!.keeperRank).toBe(2);
    expect(byId.rb2!.keeperLevel).toBe(false);
    expect(byId.qb3!.keeperRank).toBeNull(); // free agent
    expect(result.keeperLinePas).toBe(byId.qb1!.parStarter);
  });

  it("excludes rostered players below the minimum PAR from keeper eligibility", () => {
    const result = computeValuation(pool, opts);
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    // te1 is rostered but IS the replacement at TE (PAR 0 < KEEPER_MIN_PAR):
    // trivially replaceable, so no keeper rank at all.
    expect(byId.te1!.par).toBeLessThan(result.keeperMinPar);
    expect(byId.te1!.keeperRank).toBeNull();
    expect(byId.te1!.keeperLevel).toBe(false);
    expect(result.keeperMinPar).toBe(5);
  });
});

describe("overrides", () => {
  it("uses override points everywhere: ppg, ranks, PAR", () => {
    const withOverride = pool.map((p) =>
      p.playerId === "qb2"
        ? { ...p, overridePoints: 320, overrideNote: "breakout" }
        : p
    );
    const result = computeValuation(withOverride, opts);
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.qb2!.points).toBe(320);
    expect(byId.qb2!.ppg).toBe(32);
    expect(byId.qb2!.basePoints).toBe(280);
    expect(byId.qb2!.overridden).toBe(true);
    expect(byId.qb2!.positionRank).toBe(1);
    expect(byId.qb1!.positionRank).toBe(2);
    expect(byId.qb2!.par).toBe(17); // 32 - 15 (QB replacement unchanged)
  });

  it("an override can move the replacement baseline itself", () => {
    // Boost qb4 (the current QB replacement) to a startable level: he gets
    // benched in the simulation and qb3 becomes the replacement instead.
    const withOverride = pool.map((p) =>
      p.playerId === "qb4" ? { ...p, overridePoints: 250 } : p
    );
    const result = computeValuation(withOverride, opts);
    const repl = result.replacement.find((r) => r.position === "QB")!;
    expect(repl.playerId).toBe("qb3");
    expect(repl.ppg).toBe(20);
    const byId = Object.fromEntries(result.values.map((v) => [v.playerId, v]));
    expect(byId.qb1!.par).toBe(10); // 30 - 20 (was 15 before the override)
  });
});

describe("computeSeasonLuck", () => {
  // 4 teams, 2 weeks:
  //  wk1: A 100 beats B 90 (m1); C 80 beats D 70 (m2)
  //  wk2: C 95 beats A 60 (m1); D 88 beats B 85 (m2)
  const row = (
    week: number,
    rosterId: number,
    matchupId: number,
    points: number
  ): SeasonMatchupRow => ({
    week,
    rosterId,
    ownerId: `owner${rosterId}`,
    matchupId,
    points,
  });
  const rows: SeasonMatchupRow[] = [
    row(1, 1, 1, 100),
    row(1, 2, 1, 90),
    row(1, 3, 2, 80),
    row(1, 4, 2, 70),
    row(2, 1, 1, 60),
    row(2, 3, 1, 95),
    row(2, 2, 2, 85),
    row(2, 4, 2, 88),
  ];

  const byRoster = Object.fromEntries(
    computeSeasonLuck(rows).map((t) => [t.rosterId, t])
  );

  it("computes head-to-head records and points from matchup pairs", () => {
    expect(byRoster[1]).toMatchObject({ wins: 1, losses: 1, ties: 0 });
    expect(byRoster[1]!.pointsFor).toBe(160);
    expect(byRoster[1]!.pointsAgainst).toBe(185); // 90 + 95
    expect(byRoster[3]).toMatchObject({ wins: 2, losses: 0 });
  });

  it("computes all-play expected wins and luck", () => {
    // A: outscored 3/3 wk1, 0/3 wk2 -> 1.0 expected; record 1-1 -> luck 0.
    expect(byRoster[1]!.expectedWins).toBe(1);
    expect(byRoster[1]!.luck).toBe(0);
    // B: 2/3 + 1/3 = 1.0 expected but went 0-2 -> unlucky by a full win.
    expect(byRoster[2]!.luck).toBe(-1);
    // C: 1/3 + 3/3 = 1.33 expected, went 2-0 -> lucky.
    expect(byRoster[3]!.expectedWins).toBe(1.33);
    expect(byRoster[3]!.luck).toBe(0.67);
    // D: 0/3 + 2/3 = 0.67 expected, went 1-1 -> a bit lucky.
    expect(byRoster[4]!.luck).toBe(0.33);
  });

  it("counts ties as half a win on both sides", () => {
    const tied = computeSeasonLuck([
      row(1, 1, 1, 100),
      row(1, 2, 1, 100),
      row(1, 3, 2, 120),
      row(1, 4, 2, 80),
    ]);
    const t1 = tied.find((t) => t.rosterId === 1)!;
    expect(t1.ties).toBe(1);
    // All-play: beats roster 4, ties roster 2, loses to roster 3 -> 1.5/3.
    expect(t1.expectedWins).toBe(0.5);
    expect(t1.luck).toBe(0); // 0.5 actual - 0.5 expected
  });

  it("skips unplayed (all-zero) weeks", () => {
    const withFutureWeek = computeSeasonLuck([
      ...rows,
      row(3, 1, 1, 0),
      row(3, 2, 1, 0),
      row(3, 3, 2, 0),
      row(3, 4, 2, 0),
    ]);
    const t1 = withFutureWeek.find((t) => t.rosterId === 1)!;
    expect(t1.weeks).toBe(2);
    expect(t1.wins + t1.losses + t1.ties).toBe(2);
  });
});

describe("edge cases", () => {
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

  it("defaults gamesProj to 17 when non-positive", () => {
    const result = computeValuation(
      [player({ playerId: "qb1", position: "QB", basePoints: 170, gamesProj: 0 })],
      opts
    );
    expect(result.values[0]!.ppg).toBe(10);
  });
});
