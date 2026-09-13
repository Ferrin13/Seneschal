import { describe, expect, it } from "vitest";
import {
  buildLiveBoard,
  starterSlots,
  statLine,
  type LiveBoardInput,
} from "../src/thrawn/live.js";

const scoring = { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rec: 1, rec_yd: 0.1, rec_td: 6 };

function baseInput(partial: Partial<LiveBoardInput> = {}): LiveBoardInput {
  return {
    season: "2026",
    week: 1,
    fetchedAt: new Date("2026-09-13T19:00:00Z"),
    scoring,
    rosterPositions: ["QB", "FLEX", "BN"],
    teams: [
      { rosterId: 1, displayName: "alice", teamName: "Alpha", avatar: null },
      { rosterId: 2, displayName: "bob", teamName: null, avatar: null },
    ],
    matchups: [
      {
        rosterId: 1,
        matchupId: 7,
        points: 30.5,
        starters: ["qb1", "wr1"],
        players: ["qb1", "wr1", "rb9"],
        playersPoints: { qb1: 20.5, wr1: 10, rb9: 3 },
      },
      {
        rosterId: 2,
        matchupId: 7,
        points: null,
        starters: ["qb2", "0"],
        players: ["qb2"],
        playersPoints: null,
      },
    ],
    players: new Map([
      ["qb1", { name: "QB One", position: "QB", team: "BUF", injuryStatus: null }],
      ["wr1", { name: "WR One", position: "WR", team: "KC", injuryStatus: "Questionable" }],
      ["rb9", { name: "RB Nine", position: "RB", team: "DET", injuryStatus: null }],
      ["qb2", { name: "QB Two", position: "QB", team: "MIA", injuryStatus: null }],
    ]),
    stats: new Map([
      ["qb1", { stats: { pass_att: 20, pass_cmp: 15, pass_yd: 200, pass_td: 2 }, team: "BUF", opponent: "HOU" }],
      ["qb2", { stats: { pass_att: 10, pass_cmp: 5, pass_yd: 100 }, team: "MIA", opponent: "LV" }],
    ]),
    projections: new Map([
      ["qb1", { pass_yd: 250, pass_td: 2 }], // 18
      ["wr1", { rec: 5, rec_yd: 60 }], // 11
      ["qb2", { pass_yd: 300 }], // 12
      ["rb9", { rush_yd: 50 }], // 5
    ]),
    schedule: [
      { game_id: "g1", date: "2026-09-13", home: "HOU", away: "BUF", status: "complete" },
      { game_id: "g2", date: "2026-09-14", home: "KC", away: "DEN", status: "pre_game" },
      { game_id: "g3", date: "2026-09-13", home: "LV", away: "MIA", status: "in_game" },
    ],
    myRosterId: null,
    ...partial,
  };
}

describe("starterSlots", () => {
  it("drops bench and IR slots", () => {
    expect(starterSlots(["QB", "RB", "FLEX", "BN", "BN", "IR"])).toEqual(["QB", "RB", "FLEX"]);
  });
});

describe("statLine", () => {
  it("formats a passer with rushing and skips zero parts", () => {
    expect(
      statLine("QB", { pass_att: 26, pass_cmp: 18, pass_yd: 203, pass_td: 1, pass_int: 0, rush_att: 4, rush_yd: 24, rush_td: 2 })
    ).toBe("18/26, 203 yd · 1 TD · 4 car, 24 yd · 2 rush TD");
  });

  it("formats receivers, kickers and defenses", () => {
    expect(statLine("WR", { rec: 4, rec_tgt: 6, rec_yd: 58, rec_td: 1 })).toBe("4/6 rec, 58 yd · 1 rec TD");
    expect(statLine("K", { fgm: 2, fga: 3, xpm: 3, xpa: 3 })).toBe("2/3 FG · 3/3 XP");
    expect(statLine("DEF", { pts_allow: 14, sack: 3, int: 1 })).toBe("14 PA · 3 sack · 1 INT");
  });

  it("is empty before a player has done anything", () => {
    expect(statLine("RB", {})).toBe("");
  });
});

describe("buildLiveBoard", () => {
  it("pairs teams by matchup and uses Sleeper's league-scored points", () => {
    const board = buildLiveBoard(baseInput());
    expect(board.matchups).toHaveLength(1);
    const [m] = board.matchups;
    expect(m!.matchupId).toBe(7);
    expect(m!.teams.map((t) => t.rosterId)).toEqual([1, 2]);

    const alpha = m!.teams[0]!;
    expect(alpha.teamName).toBe("Alpha");
    expect(alpha.points).toBe(30.5);
    expect(alpha.starters.map((p) => p.slot)).toEqual(["QB", "FLEX"]);
    expect(alpha.starters[0]!.points).toBe(20.5);
    expect(alpha.bench.map((p) => p.playerId)).toEqual(["rb9"]);
  });

  it("falls back to league scoring of the stat line when players_points is missing", () => {
    const board = buildLiveBoard(baseInput());
    const bob = board.matchups[0]!.teams[1]!;
    expect(bob.starters[0]!.points).toBe(4); // 100 pass_yd * 0.04
    expect(bob.points).toBe(4); // sum of starters when Sleeper gives no total
  });

  it("derives game state, opponent and projected final from the schedule", () => {
    const board = buildLiveBoard(baseInput());
    const [alpha, bob] = board.matchups[0]!.teams;
    const [qb1, wr1] = alpha!.starters;
    expect(qb1!.gameState).toBe("final");
    expect(qb1!.opponent).toBe("HOU");
    expect(qb1!.home).toBe(false);
    expect(qb1!.projectedFinal).toBe(20.5); // actual once final, not the 18 projection

    expect(wr1!.gameState).toBe("pre");
    expect(wr1!.opponent).toBe("DEN");
    expect(wr1!.home).toBe(true);
    expect(wr1!.projected).toBe(11);
    expect(wr1!.projectedFinal).toBe(11); // projection before kickoff

    const [qb2, empty] = bob!.starters;
    expect(qb2!.gameState).toBe("live");
    expect(qb2!.projectedFinal).toBe(12); // max(4 actual, 12 projected) while live
    expect(empty!.playerId).toBe("");
    expect(empty!.name).toBe("Empty");

    expect(alpha!.projectedFinal).toBe(31.5);
    expect(alpha!.done).toBe(1);
    expect(alpha!.yetToPlay).toBe(1);
    expect(bob!.inPlay).toBe(1);
    expect(bob!.done).toBe(1); // the empty slot counts as done
    expect(board.anyLive).toBe(true);
  });

  it("marks players whose team has no game as bye", () => {
    const board = buildLiveBoard(baseInput());
    const rb9 = board.matchups[0]!.teams[0]!.bench[0]!;
    expect(rb9.gameState).toBe("bye");
    expect(rb9.projectedFinal).toBe(0);
  });

  it("treats DEF ids as team abbreviations", () => {
    const board = buildLiveBoard(
      baseInput({
        rosterPositions: ["DEF"],
        matchups: [
          { rosterId: 1, matchupId: 1, points: 8, starters: ["HOU"], players: ["HOU"], playersPoints: { HOU: 8 } },
        ],
      })
    );
    const def = board.matchups[0]!.teams[0]!.starters[0]!;
    expect(def.team).toBe("HOU");
    expect(def.opponent).toBe("BUF");
    expect(def.gameState).toBe("final");
  });

  it("lists my matchup first and gives unmatched teams their own card", () => {
    const board = buildLiveBoard(
      baseInput({
        myRosterId: 3,
        teams: [
          { rosterId: 1, displayName: null, teamName: null, avatar: null },
          { rosterId: 2, displayName: null, teamName: null, avatar: null },
          { rosterId: 3, displayName: "me", teamName: null, avatar: null },
        ],
        matchups: [
          { rosterId: 1, matchupId: 1, points: 0, starters: [], players: [], playersPoints: {} },
          { rosterId: 2, matchupId: 1, points: 0, starters: [], players: [], playersPoints: {} },
          { rosterId: 3, matchupId: null, points: 0, starters: [], players: [], playersPoints: {} },
        ],
      })
    );
    expect(board.matchups.map((m) => m.matchupId)).toEqual([null, 1]);
    expect(board.matchups[0]!.teams.map((t) => t.rosterId)).toEqual([3]);
  });
});
