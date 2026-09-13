/**
 * Pure live-scoring board for one league week.
 *
 * Sleeper has no push feed, so the service polls three unauthenticated
 * endpoints and this module joins them:
 *  - league matchups: Sleeper's own league-scored points per rostered
 *    player (`players_points`) and per team (`points`);
 *  - the week's stat lines, for the box-score text and the game each
 *    player is in;
 *  - the NFL schedule, whose per-game status tells whether a starter is
 *    yet to play, playing, or done.
 * Weekly projections give a "projected final": done players count their
 * actual, unplayed players their projection, and in-progress players the
 * larger of the two (Sleeper exposes no game clock to blend with).
 *
 * Everything here is I/O-free so it can be unit tested.
 */
import { scoreProjection } from "./engine.js";

/** Where a player's NFL game stands: bye/empty slot, not kicked off, in progress, over. */
export type GameState = "bye" | "pre" | "live" | "final";

export type LiveGame = {
  gameId: string;
  home: string;
  away: string;
  status: string;
  date: string;
  state: Exclude<GameState, "bye">;
};

export type LivePlayer = {
  /** Lineup slot (QB, FLEX, ...) or BN for bench. */
  slot: string;
  /** Empty string for an empty lineup slot. */
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  opponent: string | null;
  /** True when the player's team hosts; null when there is no game. */
  home: boolean | null;
  gameState: GameState;
  injuryStatus: string | null;
  /** League-scored points so far this week. */
  points: number;
  /** League-scored weekly projection (pre-game estimate). */
  projected: number;
  /** Projected final: actual once done, projection before, max while live. */
  projectedFinal: number;
  /** Compact box score, e.g. "18/26, 203 yd, 1 TD · 4 car, 24 yd, 2 TD". */
  statLine: string;
};

export type LiveTeam = {
  rosterId: number;
  displayName: string | null;
  teamName: string | null;
  avatar: string | null;
  points: number;
  projectedFinal: number;
  starters: LivePlayer[];
  bench: LivePlayer[];
  /** Starter counts by game state (empty slots count as done). */
  yetToPlay: number;
  inPlay: number;
  done: number;
};

export type LiveMatchup = {
  matchupId: number | null;
  /** Two teams for a head-to-head; one when a team has no matchup (bye). */
  teams: LiveTeam[];
};

export type LiveBoard = {
  season: string;
  week: number;
  fetchedAt: string;
  games: LiveGame[];
  /** Any NFL game currently in progress; clients poll faster while true. */
  anyLive: boolean;
  matchups: LiveMatchup[];
};

export type LiveTeamInput = {
  rosterId: number;
  displayName: string | null;
  teamName: string | null;
  avatar: string | null;
};

export type LiveMatchupInput = {
  rosterId: number;
  matchupId: number | null;
  points: number | null;
  starters: string[] | null;
  players: string[] | null;
  playersPoints: Record<string, number> | null;
};

export type LivePlayerInfo = {
  name: string;
  position: string | null;
  team: string | null;
  injuryStatus: string | null;
};

export type LiveStatInput = {
  stats: Record<string, number> | null;
  team: string | null;
  opponent: string | null;
};

export type LiveScheduleGame = {
  game_id: string;
  date: string;
  home: string;
  away: string;
  status: string;
};

export type LiveBoardInput = {
  season: string;
  week: number;
  fetchedAt: Date;
  scoring: Record<string, number>;
  rosterPositions: string[];
  teams: LiveTeamInput[];
  matchups: LiveMatchupInput[];
  /** Sleeper player id -> dictionary entry (DEF ids are team abbreviations). */
  players: Map<string, LivePlayerInfo>;
  /** Sleeper player id -> this week's stat line. */
  stats: Map<string, LiveStatInput>;
  /** Sleeper player id -> this week's stat-level projection. */
  projections: Map<string, Record<string, number>>;
  /** This week's NFL games only. */
  schedule: LiveScheduleGame[];
  /** Listed first when set. */
  myRosterId: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const num = (stats: Record<string, number>, key: string): number => stats[key] ?? 0;

function gameState(status: string): Exclude<GameState, "bye"> {
  if (status === "in_game") return "live";
  if (status === "pre_game") return "pre";
  // complete, canceled, and anything unknown: no more points are coming.
  return "final";
}

/**
 * Compact box-score text per position family. Zero-valued parts are
 * dropped so a quiet player reads "2 rec, 14 yd" rather than a wall of 0s.
 */
export function statLine(position: string | null, stats: Record<string, number>): string {
  const parts: string[] = [];
  const push = (cond: boolean, text: string) => {
    if (cond) parts.push(text);
  };
  if (position === "QB") {
    push(num(stats, "pass_att") > 0, `${num(stats, "pass_cmp")}/${num(stats, "pass_att")}, ${num(stats, "pass_yd")} yd`);
    push(num(stats, "pass_td") > 0, `${num(stats, "pass_td")} TD`);
    push(num(stats, "pass_int") > 0, `${num(stats, "pass_int")} INT`);
    push(num(stats, "rush_att") > 0, `${num(stats, "rush_att")} car, ${num(stats, "rush_yd")} yd`);
    push(num(stats, "rush_td") > 0, `${num(stats, "rush_td")} rush TD`);
    push(num(stats, "fum_lost") > 0, `${num(stats, "fum_lost")} FUM`);
  } else if (position === "K") {
    push(num(stats, "fga") > 0, `${num(stats, "fgm")}/${num(stats, "fga")} FG`);
    push(num(stats, "xpa") > 0, `${num(stats, "xpm")}/${num(stats, "xpa")} XP`);
  } else if (position === "DEF") {
    push("pts_allow" in stats, `${num(stats, "pts_allow")} PA`);
    push(num(stats, "sack") > 0, `${num(stats, "sack")} sack`);
    push(num(stats, "int") > 0, `${num(stats, "int")} INT`);
    push(num(stats, "fum_rec") > 0, `${num(stats, "fum_rec")} FR`);
    push(num(stats, "def_td") > 0, `${num(stats, "def_td")} TD`);
    push(num(stats, "safe") > 0, `${num(stats, "safe")} SAF`);
    push(num(stats, "blk_kick") > 0, `${num(stats, "blk_kick")} BLK`);
  } else {
    push(num(stats, "rush_att") > 0, `${num(stats, "rush_att")} car, ${num(stats, "rush_yd")} yd`);
    push(num(stats, "rush_td") > 0, `${num(stats, "rush_td")} rush TD`);
    push(num(stats, "rec_tgt") > 0 || num(stats, "rec") > 0, `${num(stats, "rec")}/${num(stats, "rec_tgt")} rec, ${num(stats, "rec_yd")} yd`);
    push(num(stats, "rec_td") > 0, `${num(stats, "rec_td")} rec TD`);
    push(num(stats, "pass_td") > 0, `${num(stats, "pass_td")} pass TD`);
    push(num(stats, "fum_lost") > 0, `${num(stats, "fum_lost")} FUM`);
  }
  return parts.join(" · ");
}

/** Lineup slots in Sleeper's starters order (bench and IR are not starters). */
export function starterSlots(rosterPositions: string[]): string[] {
  return rosterPositions.filter((p) => p !== "BN" && p !== "IR");
}

function emptySlot(slot: string): LivePlayer {
  return {
    slot,
    playerId: "",
    name: "Empty",
    position: null,
    team: null,
    opponent: null,
    home: null,
    gameState: "bye",
    injuryStatus: null,
    points: 0,
    projected: 0,
    projectedFinal: 0,
    statLine: "",
  };
}

export function buildLiveBoard(input: LiveBoardInput): LiveBoard {
  const gameByTeam = new Map<string, LiveGame>();
  const games: LiveGame[] = input.schedule.map((g) => ({
    gameId: g.game_id,
    home: g.home,
    away: g.away,
    status: g.status,
    date: g.date,
    state: gameState(g.status),
  }));
  for (const g of games) {
    gameByTeam.set(g.home, g);
    gameByTeam.set(g.away, g);
  }

  const buildPlayer = (
    slot: string,
    playerId: string,
    playersPoints: Record<string, number> | null
  ): LivePlayer => {
    if (playerId === "0" || playerId === "") return emptySlot(slot);
    const info = input.players.get(playerId);
    const stat = input.stats.get(playerId);
    const stats = stat?.stats ?? {};
    // DEF ids are the team abbreviation itself.
    const team = stat?.team ?? info?.team ?? (playerId.length <= 3 ? playerId : null);
    const game = team ? gameByTeam.get(team) : undefined;
    const state: GameState = game ? game.state : "bye";
    const points =
      playersPoints?.[playerId] ?? round2(scoreProjection(stats, input.scoring));
    const projRow = input.projections.get(playerId);
    const projected = projRow ? round2(scoreProjection(projRow, input.scoring)) : 0;
    const projectedFinal =
      state === "final"
        ? points
        : state === "pre"
          ? projected
          : state === "live"
            ? Math.max(points, projected)
            : 0;
    return {
      slot,
      playerId,
      name: info?.name ?? playerId,
      position: info?.position ?? null,
      team,
      opponent: game ? (game.home === team ? game.away : game.home) : null,
      home: game ? game.home === team : null,
      gameState: state,
      injuryStatus: info?.injuryStatus ?? null,
      points: round2(points),
      projected,
      projectedFinal: round2(projectedFinal),
      statLine: statLine(info?.position ?? null, stats),
    };
  };

  const slots = starterSlots(input.rosterPositions);
  const teamInfo = new Map(input.teams.map((t) => [t.rosterId, t]));

  const liveTeams = input.matchups.map((m): LiveTeam => {
    const info = teamInfo.get(m.rosterId);
    const starterIds = m.starters ?? [];
    const starters = slots.map((slot, i) =>
      buildPlayer(slot, starterIds[i] ?? "0", m.playersPoints)
    );
    const starterSet = new Set(starterIds);
    const bench = (m.players ?? [])
      .filter((id) => !starterSet.has(id))
      .map((id) => buildPlayer("BN", id, m.playersPoints))
      .sort((a, b) => b.points - a.points);
    const points =
      m.points ?? round2(starters.reduce((s, p) => s + p.points, 0));
    return {
      rosterId: m.rosterId,
      displayName: info?.displayName ?? null,
      teamName: info?.teamName ?? null,
      avatar: info?.avatar ?? null,
      points: round2(points),
      projectedFinal: round2(starters.reduce((s, p) => s + p.projectedFinal, 0)),
      starters,
      bench,
      yetToPlay: starters.filter((p) => p.gameState === "pre").length,
      inPlay: starters.filter((p) => p.gameState === "live").length,
      done: starters.filter((p) => p.gameState === "final" || p.gameState === "bye").length,
    };
  });

  const groups = new Map<number | null, LiveTeam[]>();
  for (const t of liveTeams) {
    const id = input.matchups.find((m) => m.rosterId === t.rosterId)?.matchupId ?? null;
    if (id == null) {
      groups.set(-t.rosterId, [t]); // unique key per unmatched team
      continue;
    }
    const list = groups.get(id) ?? [];
    list.push(t);
    groups.set(id, list);
  }

  const matchups: LiveMatchup[] = [...groups.entries()].map(([key, teams]) => ({
    matchupId: key != null && key > 0 ? key : null,
    teams: teams.sort((a, b) => a.rosterId - b.rosterId),
  }));
  matchups.sort((a, b) => {
    const mine = (m: LiveMatchup) =>
      input.myRosterId != null && m.teams.some((t) => t.rosterId === input.myRosterId) ? 0 : 1;
    const byMine = mine(a) - mine(b);
    if (byMine !== 0) return byMine;
    return (a.matchupId ?? Number.MAX_SAFE_INTEGER) - (b.matchupId ?? Number.MAX_SAFE_INTEGER);
  });

  return {
    season: input.season,
    week: input.week,
    fetchedAt: input.fetchedAt.toISOString(),
    games,
    anyLive: games.some((g) => g.state === "live"),
    matchups,
  };
}
