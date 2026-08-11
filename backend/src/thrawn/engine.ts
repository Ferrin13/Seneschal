/**
 * Thrawn valuation engine — pure functions, no I/O.
 *
 * The central concept is Points Above Replacement (PAR), expressed per game: a
 * player's projected points per game minus the points per game of the
 * "replacement player" at his position.
 *
 * The replacement player is projection-based and sits at FRINGE BENCH depth:
 * simulate every roster in the league being filled — dedicated starting
 * slots, then flex slots, then bench slots — and the replacement at each
 * position is the best player left over. Bench seats are allocated greedily
 * by value over the position's starter-level baseline, mirroring how real
 * benches get drafted (RB/WR depth soaks up bench spots; nobody stashes a
 * third QB or a backup kicker). Position scarcity falls out naturally, and
 * the baseline is immune to how many good players happen to be unrostered
 * pre-draft. The same simulation prices past seasons from their actual
 * per-game scoring.
 *
 * A second baseline, the league-average starter, is reported alongside: the
 * median starter at the position once flex seats are accounted for (e.g. the
 * 5th-6th QB in a 10-team 1QB league). PAR vs. this baseline separates true
 * difference-makers from merely startable players.
 */

export type EnginePlayerInput = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
  age: number | null;
  /** League-scored season-total points from the public projection. */
  basePoints: number;
  /** Projected games for the season (per-game denominator). */
  gamesProj: number;
  /** User override of season-total projected points; null = use basePoints. */
  overridePoints: number | null;
  overrideNote: string | null;
  /** Average draft position (PPR) for reference; null when unknown. */
  adp: number | null;
  /** Roster this player belongs to; null = free agent (waiver wire). */
  rosterId: number | null;
  /** League-scored season totals per projection source, for display. */
  sourcePoints?: Record<string, number>;
  /** NFL bye week for the player's team this season; null when unknown. */
  byeWeek?: number | null;
  /**
   * Week-by-week projected points in a source's own scoring (index =
   * week - 1, zeros on byes). Used as a season shape; null when absent.
   */
  weekly?: number[] | null;
};

/** One player's actual line in one past season (league-scored totals). */
export type SeasonStatLine = {
  playerId: string;
  position: string;
  /** League-scored season-total points. */
  points: number;
  /** Games played. */
  gp: number;
};

export type SeasonHistoryInput = {
  season: string;
  players: SeasonStatLine[];
};

export type PlayerSeasonPar = {
  season: string;
  gp: number;
  /** Actual points per game that season (league scoring). */
  ppg: number;
  /** Per-game PAR vs. that season's structural replacement level. */
  par: number;
  /** Per-game PAS vs. that season's league-average starter. */
  pas: number;
  /** 1-based position finish that season by total points (e.g. RB12). */
  posRank: number;
};

export type PlayerValue = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
  age: number | null;
  basePoints: number;
  /** Effective season-total projected points (override when present). */
  points: number;
  gamesProj: number;
  /** Effective projected points per game. */
  ppg: number;
  overridden: boolean;
  overrideNote: string | null;
  adp: number | null;
  rosterId: number | null;
  /** 1-based rank within the position by effective ppg. */
  positionRank: number;
  /** Points per game of the fringe bench-level player at this position. */
  replacementPpg: number;
  /** Per-game points above replacement: ppg - replacementPpg. */
  par: number;
  /** Per-game value above the league-average (median) starter. */
  parStarter: number;
  /** Per-game PAR in each of the past seasons provided (newest first). */
  history: PlayerSeasonPar[];
  /** Population variance of the historical per-game PARs (>=2 seasons). */
  parVariance: number | null;
  /** 1-based rank by PAS among rostered players only; null for free agents. */
  keeperRank: number | null;
  /** True when this rostered player sits inside the league's keeper slots. */
  keeperLevel: boolean;
  /** League-scored season totals per projection source. */
  sourcePoints: Record<string, number>;
  /** NFL bye week for the player's team this season; null when unknown. */
  byeWeek: number | null;
  /** Weekly projection shape (source scoring, index = week - 1). */
  weekly: number[] | null;
};

export type ReplacementLevel = {
  position: string;
  /** Points per game of the replacement (first player beyond all rosters). */
  ppg: number;
  /** 1-based position rank the replacement sits at (starters + bench + 1). */
  rank: number;
  playerId: string | null;
  playerName: string | null;
  /** Starters this position absorbs league-wide (dedicated + flex share). */
  starterCount: number;
  /** Points per game of the league-average (median) starter. */
  avgStarterPpg: number;
};

export type ValuationResult = {
  values: PlayerValue[];
  replacement: ReplacementLevel[];
  /** Total keeper slots league-wide (maxKeepers * numTeams). */
  keeperSlots: number;
  /** Per-game PAS of the last player inside the keeper slots. */
  keeperLinePas: number | null;
  /** Minimum per-game PAR required to be keeper-eligible. */
  keeperMinPar: number;
};

/**
 * Minimum per-game PAR to be keeper-eligible. Keeping a player only pays
 * off when he clearly beats freely-available replacements; K/DEF top out
 * around +2 PAR/G because streaming-level options sit right behind them.
 */
export const KEEPER_MIN_PAR = 5;

/** Which base positions may fill each flex-style roster slot. */
const FLEX_ELIGIBILITY: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

const BASE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

/**
 * Positions that realistically occupy bench slots. Nobody stashes a second
 * kicker or defense, and kicker scoring is flat enough that a raw
 * value-over-baseline fill would otherwise leak bench seats to them.
 */
const BENCH_ELIGIBLE = new Set(["QB", "RB", "WR", "TE"]);

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * League-accurate fantasy points for a stat-level projection: the sum over
 * every scoring category of (projected stat) x (points per unit). Stat keys
 * in Sleeper feeds line up with scoring_settings keys, and non-scoring keys
 * (adp_*, pts_*, gp) are simply never looked up.
 */
export function scoreProjection(
  stats: Record<string, number>,
  scoring: Record<string, number>
): number {
  let total = 0;
  for (const [key, perUnit] of Object.entries(scoring)) {
    const amount = stats[key];
    if (amount != null && perUnit !== 0) total += amount * perUnit;
  }
  return round2(total);
}

/**
 * League-wide rostered counts per position from actual rosters — the most
 * faithful composition anchor, since this league's managers already showed
 * how many of each position they carry. Only the COUNT is taken from
 * rosters; the replacement itself is still priced by projection rank, so a
 * stud sitting on waivers cannot inflate the baseline. Returns null when
 * rosters are too empty to trust (e.g. pre-draft keeper stubs).
 */
export function positionCountsFromRosters(
  rostered: { position: string }[],
  totalPicks: number
): Map<string, number> | null {
  const eligible = rostered.filter((p) => BASE_POSITIONS.has(p.position));
  if (eligible.length < totalPicks / 2) return null;
  const counts = new Map<string, number>();
  for (const p of eligible) {
    counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  }
  return counts;
}

/**
 * Fallback composition anchor when rosters are too sparse: sort every
 * player by ADP, take the first numTeams x rosterSize picks (a full
 * draft), and count positions. Generic ADP skews toward typical 12-team
 * drafts (late TE/QB stashes, few K/DEF), so actual rosters are preferred.
 * Returns null when ADP coverage is too thin to trust (callers then fall
 * back to the structural bench simulation).
 */
export function positionCountsFromAdp(
  players: { position: string; adp: number | null }[],
  totalPicks: number
): Map<string, number> | null {
  const drafted = players
    .filter((p) => p.adp != null && BASE_POSITIONS.has(p.position))
    .sort((a, b) => a.adp! - b.adp!);
  if (drafted.length < totalPicks / 2) return null;
  const counts = new Map<string, number>();
  for (const p of drafted.slice(0, totalPicks)) {
    counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  }
  return counts;
}

/**
 * Fringe-bench replacement levels, purely from projections.
 *
 * Simulates the league's rosters being filled:
 *  1. Dedicated starting slots consume the top players at each position.
 *  2. Flex slots are filled greedily league-wide by points per game.
 *  3. Bench depth: when `rosterCounts` (ADP-derived league-wide rostered
 *     counts per position) is provided, each position is consumed to that
 *     count — real benches skew heavily to RB/WR, which no value-greedy
 *     fill reproduces. Without counts, bench slots are filled greedily by
 *     value over the position's starter baseline (QB/RB/WR/TE only).
 *
 * The replacement at each position is the best player left after all
 * passes: the best "fringe bench" player nobody would roster.
 */
export function replacementLevels(
  players: { playerId: string; name: string; position: string; ppg: number }[],
  rosterPositions: string[],
  numTeams: number,
  rosterCounts?: Map<string, number> | null
): Map<string, ReplacementLevel> {
  const pools = new Map<
    string,
    { playerId: string; name: string; ppg: number }[]
  >();
  for (const p of players) {
    if (!BASE_POSITIONS.has(p.position)) continue;
    const pool = pools.get(p.position) ?? [];
    pool.push({ playerId: p.playerId, name: p.name, ppg: p.ppg });
    pools.set(p.position, pool);
  }
  for (const pool of pools.values()) pool.sort((a, b) => b.ppg - a.ppg);

  const slotCounts = new Map<string, number>();
  for (const slot of rosterPositions) {
    slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
  }

  // consumed[pos] = players at pos already seated on a roster.
  const consumed = new Map<string, number>();
  for (const pos of pools.keys()) consumed.set(pos, 0);
  const next = (pos: string) => pools.get(pos)?.[consumed.get(pos) ?? 0];

  // Pass 1: dedicated starting slots.
  for (const [slot, count] of slotCounts) {
    if (BASE_POSITIONS.has(slot)) {
      consumed.set(slot, (consumed.get(slot) ?? 0) + count * numTeams);
    }
  }

  // Pass 2: greedy flex fill by raw ppg.
  for (const [slot, count] of slotCounts) {
    const eligible = FLEX_ELIGIBILITY[slot];
    if (!eligible) continue;
    let seats = count * numTeams;
    while (seats > 0) {
      let bestPos: string | null = null;
      let bestPpg = -Infinity;
      for (const pos of eligible) {
        const n = next(pos);
        if (n && n.ppg > bestPpg) {
          bestPpg = n.ppg;
          bestPos = pos;
        }
      }
      if (!bestPos) break;
      consumed.set(bestPos, (consumed.get(bestPos) ?? 0) + 1);
      seats--;
    }
  }

  // Starter counts and the league-average starter: with n starters at a
  // position (dedicated + flex share), the average starter is the median —
  // e.g. the 5th-6th QB in a 10-team 1QB league, or the 12th-14th RB once
  // flex seats are counted.
  const starterCounts = new Map<string, number>();
  const avgStarterPpg = new Map<string, number>();
  for (const [pos, pool] of pools) {
    const n = consumed.get(pos) ?? 0;
    starterCounts.set(pos, n);
    if (pool.length === 0) {
      avgStarterPpg.set(pos, 0);
    } else if (n === 0) {
      avgStarterPpg.set(pos, pool[0]!.ppg);
    } else {
      const lo = Math.min(Math.floor((n - 1) / 2), pool.length - 1);
      const hi = Math.min(Math.floor(n / 2), pool.length - 1);
      avgStarterPpg.set(pos, (pool[lo]!.ppg + pool[hi]!.ppg) / 2);
    }
  }

  // Starter-level baseline per position: the best player not seated after
  // starters are filled. Bench value is measured against this.
  const starterBaseline = new Map<string, number>();
  for (const pos of pools.keys()) {
    starterBaseline.set(pos, next(pos)?.ppg ?? 0);
  }

  // Pass 3: bench depth. Preferred: consume each position to its
  // ADP-derived league-wide rostered count (starters act as a floor, so a
  // position undersupplied in ADP still clears its starting slots).
  // Fallback: greedy fill by value over the starter baseline, QB/RB/WR/TE
  // only (nobody benches kickers or defenses).
  if (rosterCounts) {
    for (const pos of pools.keys()) {
      const target = rosterCounts.get(pos) ?? 0;
      if (target > (consumed.get(pos) ?? 0)) consumed.set(pos, target);
    }
  } else {
    const benchPositions = [...pools.keys()]
      .filter((p) => BENCH_ELIGIBLE.has(p))
      .sort();
    let benchSeats = (slotCounts.get("BN") ?? 0) * numTeams;
    while (benchSeats > 0) {
      let bestPos: string | null = null;
      let bestValue = -Infinity;
      let bestPpg = -Infinity;
      for (const pos of benchPositions) {
        const n = next(pos);
        if (!n) continue;
        const value = n.ppg - (starterBaseline.get(pos) ?? 0);
        if (value > bestValue || (value === bestValue && n.ppg > bestPpg)) {
          bestValue = value;
          bestPpg = n.ppg;
          bestPos = pos;
        }
      }
      if (!bestPos) break;
      consumed.set(bestPos, (consumed.get(bestPos) ?? 0) + 1);
      benchSeats--;
    }
  }

  const result = new Map<string, ReplacementLevel>();
  for (const [pos, pool] of pools) {
    const idx = consumed.get(pos) ?? 0;
    const repl = pool[idx] ?? pool[pool.length - 1] ?? null;
    result.set(pos, {
      position: pos,
      ppg: repl ? round2(repl.ppg) : 0,
      rank: Math.min(idx, pool.length - 1) + 1,
      playerId: repl?.playerId ?? null,
      playerName: repl?.name ?? null,
      starterCount: starterCounts.get(pos) ?? 0,
      avgStarterPpg: round2(avgStarterPpg.get(pos) ?? 0),
    });
  }
  return result;
}

/** One team's score in one week, as stored from the Sleeper matchup feed. */
export type SeasonMatchupRow = {
  week: number;
  rosterId: number;
  ownerId: string | null;
  matchupId: number | null;
  points: number;
};

export type TeamSeasonLuck = {
  /** Roster id in THAT season's league (ids shuffle between seasons). */
  rosterId: number;
  ownerId: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /**
   * All-play expected wins: each week, the share of other teams outscored
   * (ties count half), summed over the season. What the record "should" be
   * if the schedule didn't matter.
   */
  expectedWins: number;
  /** Actual wins (ties count half) minus expected wins; positive = lucky. */
  luck: number;
  weeks: number;
};

/**
 * Season luck from weekly scores: actual head-to-head record (paired by
 * matchupId) vs. the all-play record. A team that outscores 7 of 9 teams
 * every week "deserves" ~0.78 wins/week; if the schedule handed it fewer,
 * the difference shows up as negative luck.
 */
export function computeSeasonLuck(rows: SeasonMatchupRow[]): TeamSeasonLuck[] {
  const byWeek = new Map<number, SeasonMatchupRow[]>();
  for (const row of rows) {
    const list = byWeek.get(row.week) ?? [];
    list.push(row);
    byWeek.set(row.week, list);
  }

  const teams = new Map<number, TeamSeasonLuck>();
  const team = (row: SeasonMatchupRow): TeamSeasonLuck => {
    let t = teams.get(row.rosterId);
    if (!t) {
      t = {
        rosterId: row.rosterId,
        ownerId: row.ownerId,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        expectedWins: 0,
        luck: 0,
        weeks: 0,
      };
      teams.set(row.rosterId, t);
    }
    return t;
  };

  for (const list of byWeek.values()) {
    // Skip unplayed weeks (e.g. a synced-mid-season future week).
    if (list.every((r) => r.points === 0)) continue;
    for (const row of list) {
      const t = team(row);
      t.weeks += 1;
      t.pointsFor += row.points;

      const others = list.filter((r) => r.rosterId !== row.rosterId);
      if (others.length > 0) {
        const outscored = others.filter((o) => o.points < row.points).length;
        const tied = others.filter((o) => o.points === row.points).length;
        t.expectedWins += (outscored + tied * 0.5) / others.length;
      }

      const opponent =
        row.matchupId != null
          ? others.find((o) => o.matchupId === row.matchupId)
          : undefined;
      if (opponent) {
        t.pointsAgainst += opponent.points;
        if (row.points > opponent.points) t.wins += 1;
        else if (row.points < opponent.points) t.losses += 1;
        else t.ties += 1;
      }
    }
  }

  const result = [...teams.values()].map((t) => ({
    ...t,
    pointsFor: round2(t.pointsFor),
    pointsAgainst: round2(t.pointsAgainst),
    expectedWins: round2(t.expectedWins),
    luck: round2(t.wins + t.ties * 0.5 - t.expectedWins),
  }));
  result.sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);
  return result;
}

/** Population variance; null when fewer than two samples. */
function variance(samples: number[]): number | null {
  if (samples.length < 2) return null;
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  return round2(
    samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length
  );
}

export function computeValuation(
  players: EnginePlayerInput[],
  opts: {
    rosterPositions: string[];
    numTeams: number;
    maxKeepers: number;
    /** Past seasons' actual stat lines, newest first. */
    history?: SeasonHistoryInput[];
    /** ADP-derived league-wide rostered counts per position. */
    rosterCounts?: Map<string, number> | null;
  }
): ValuationResult {
  const effective = players
    .filter((p) => BASE_POSITIONS.has(p.position))
    .map((p) => {
      const points = p.overridePoints ?? p.basePoints;
      const games = p.gamesProj > 0 ? p.gamesProj : 17;
      return { ...p, points, ppg: round2(points / games) };
    });

  const replacementByPos = replacementLevels(
    effective,
    opts.rosterPositions,
    opts.numTeams,
    opts.rosterCounts
  );

  // Historical replacement levels + per-player season lines, priced with the
  // same fringe-bench simulation on each season's actual per-game scoring.
  const history = opts.history ?? [];
  const historyByPlayer = new Map<string, PlayerSeasonPar[]>();
  for (const season of history) {
    const withPpg = season.players
      .filter((l) => BASE_POSITIONS.has(l.position) && l.gp > 0)
      .map((l) => ({ ...l, name: l.playerId, ppg: l.points / l.gp }));
    // Roster composition is a property of the league's shape, so the same
    // ADP-derived counts apply to past seasons' player pools.
    const repl = replacementLevels(
      withPpg,
      opts.rosterPositions,
      opts.numTeams,
      opts.rosterCounts
    );
    // Season-total position finish (the standard "ended as RB12" measure).
    const seasonPosRank = new Map<string, number>();
    const byPos = new Map<string, typeof withPpg>();
    for (const l of withPpg) {
      const list = byPos.get(l.position) ?? [];
      list.push(l);
      byPos.set(l.position, list);
    }
    for (const list of byPos.values()) {
      [...list]
        .sort((a, b) => b.points - a.points)
        .forEach((l, i) => seasonPosRank.set(l.playerId, i + 1));
    }
    for (const line of withPpg) {
      const list = historyByPlayer.get(line.playerId) ?? [];
      const posRepl = repl.get(line.position);
      list.push({
        season: season.season,
        gp: line.gp,
        ppg: round2(line.ppg),
        par: round2(line.ppg - (posRepl?.ppg ?? 0)),
        pas: round2(line.ppg - (posRepl?.avgStarterPpg ?? 0)),
        posRank: seasonPosRank.get(line.playerId) ?? 0,
      });
      historyByPlayer.set(line.playerId, list);
    }
  }

  // Position ranks by effective ppg.
  const byPosition = new Map<string, typeof effective>();
  for (const p of effective) {
    const list = byPosition.get(p.position) ?? [];
    list.push(p);
    byPosition.set(p.position, list);
  }
  const positionRank = new Map<string, number>();
  for (const list of byPosition.values()) {
    list.sort((a, b) => b.ppg - a.ppg);
    list.forEach((p, i) => positionRank.set(p.playerId, i + 1));
  }

  const values: PlayerValue[] = effective.map((p) => {
    const repl = replacementByPos.get(p.position);
    const replPpg = repl?.ppg ?? 0;
    const avgStarterPpg = repl?.avgStarterPpg ?? 0;
    const playerHistory = (historyByPlayer.get(p.playerId) ?? []).sort((a, b) =>
      b.season.localeCompare(a.season)
    );
    return {
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      team: p.team,
      injuryStatus: p.injuryStatus,
      age: p.age,
      basePoints: p.basePoints,
      points: p.points,
      gamesProj: p.gamesProj,
      ppg: p.ppg,
      overridden: p.overridePoints != null,
      overrideNote: p.overrideNote,
      adp: p.adp,
      rosterId: p.rosterId,
      positionRank: positionRank.get(p.playerId) ?? 0,
      replacementPpg: replPpg,
      par: round2(p.ppg - replPpg),
      parStarter: round2(p.ppg - avgStarterPpg),
      history: playerHistory,
      parVariance: variance(playerHistory.map((h) => h.par)),
      keeperRank: null,
      keeperLevel: false,
      sourcePoints: p.sourcePoints ?? {},
      byeWeek: p.byeWeek ?? null,
      weekly: p.weekly ?? null,
    };
  });

  // Keeper line: rank rostered players by per-game PAS (points above the
  // league-average starter); the top (maxKeepers * numTeams) are "keeper
  // level". Eligibility requires a minimum PAR — a keeper slot is only
  // worth spending on a player who clearly beats what's freely available,
  // which rules out K/DEF-style players whose PAS can rank high while the
  // waiver wire sits right behind them.
  const keeperSlots = opts.maxKeepers * opts.numTeams;
  const eligible = values
    .filter((v) => v.rosterId != null && v.par >= KEEPER_MIN_PAR)
    .sort((a, b) => b.parStarter - a.parStarter);
  eligible.forEach((v, i) => {
    v.keeperRank = i + 1;
    v.keeperLevel = i < keeperSlots;
  });
  const keeperLinePas =
    eligible.length >= keeperSlots && keeperSlots > 0
      ? eligible[keeperSlots - 1]!.parStarter
      : null;

  values.sort((a, b) => b.parStarter - a.parStarter);

  return {
    values,
    replacement: [...replacementByPos.values()].sort((a, b) =>
      a.position.localeCompare(b.position)
    ),
    keeperSlots,
    keeperLinePas,
    keeperMinPar: KEEPER_MIN_PAR,
  };
}

// ---------------------------------------------------------------------------
// Regression / progression analysis
//
// Compares each player's actual season against what his VOLUME would predict:
// expected touchdowns from overall + red-zone opportunities, expected yards
// from opportunities at the cohort's per-opportunity rate, and expected
// receptions from targets at the cohort's catch rate. Deviations are priced
// with the league's scoring so "TD luck" and efficiency outliers surface as
// regression (sell-high) or progression (buy-low) candidates.

/** One offensive phase's actual vs. volume-expected line. */
export type RegressionPhase = {
  phase: "pass" | "rush" | "rec";
  /** Opportunities: pass/rush attempts or targets. */
  volume: number;
  /** Red-zone share of those opportunities. */
  rzVolume: number;
  actualTd: number;
  expTd: number;
  actualYd: number;
  expYd: number;
  /** Receptions (rec phase only). */
  actualRec: number | null;
  expRec: number | null;
  /** League-scored points of (actual - expected) across TD/yd/rec. */
  deltaPts: number;
};

export type RegressionRow = {
  playerId: string;
  name: string;
  position: string;
  gp: number;
  phases: RegressionPhase[];
  /** Season-total league-scored points above/below volume expectation. */
  deltaPts: number;
  deltaPtsPerGame: number;
};

export type RegressionInputLine = {
  playerId: string;
  name: string;
  position: string;
  gp: number;
  stats: Record<string, number>;
};

/**
 * Least-squares fit (no intercept) of td ~ base*(vol - rz) + rz*rzVol over a
 * cohort, clamped to non-negative rates. Falls back to the cohort's single
 * aggregate TD-per-opportunity rate when the fit is degenerate (e.g. no
 * red-zone data) or produces a negative coefficient.
 */
function fitTdRates(
  rows: { vol: number; rz: number; td: number }[]
): { base: number; rz: number } {
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let sy1 = 0;
  let sy2 = 0;
  let svol = 0;
  let std = 0;
  for (const r of rows) {
    const x1 = r.vol - r.rz;
    const x2 = r.rz;
    s11 += x1 * x1;
    s12 += x1 * x2;
    s22 += x2 * x2;
    sy1 += x1 * r.td;
    sy2 += x2 * r.td;
    svol += r.vol;
    std += r.td;
  }
  const single = svol > 0 ? std / svol : 0;
  const det = s11 * s22 - s12 * s12;
  if (rows.length < 5 || det < 1e-6) return { base: single, rz: single };
  const base = (sy1 * s22 - sy2 * s12) / det;
  const rz = (s11 * sy2 - s12 * sy1) / det;
  if (base < 0 || rz < 0) return { base: single, rz: single };
  return { base, rz };
}

type PhaseSpec = {
  phase: RegressionPhase["phase"];
  volKey: string;
  rzKey: string;
  tdKey: string;
  ydKey: string;
  recKey: string | null;
  tdScoreKey: string;
  ydScoreKey: string;
  /** Positions that get this phase evaluated. */
  positions: Set<string>;
  /** Position -> rate cohort (rare rushers borrow the RB cohort). */
  cohortOf: (position: string) => string;
  minVolume: number;
};

const PHASE_SPECS: PhaseSpec[] = [
  {
    phase: "pass",
    volKey: "pass_att",
    rzKey: "pass_rz_att",
    tdKey: "pass_td",
    ydKey: "pass_yd",
    recKey: null,
    tdScoreKey: "pass_td",
    ydScoreKey: "pass_yd",
    positions: new Set(["QB"]),
    cohortOf: () => "QB",
    minVolume: 100,
  },
  {
    phase: "rush",
    volKey: "rush_att",
    rzKey: "rush_rz_att",
    tdKey: "rush_td",
    ydKey: "rush_yd",
    recKey: null,
    tdScoreKey: "rush_td",
    ydScoreKey: "rush_yd",
    positions: new Set(["QB", "RB", "WR", "TE"]),
    // QB rushing (sneaks, scrambles) behaves differently from RB carries;
    // WR/TE rushers are too rare to fit and borrow the RB cohort.
    cohortOf: (pos) => (pos === "QB" ? "QB" : "RB"),
    minVolume: 25,
  },
  {
    phase: "rec",
    volKey: "rec_tgt",
    rzKey: "rec_rz_tgt",
    tdKey: "rec_td",
    ydKey: "rec_yd",
    recKey: "rec",
    tdScoreKey: "rec_td",
    ydScoreKey: "rec_yd",
    positions: new Set(["RB", "WR", "TE"]),
    // Target quality differs by position (RB dumpoffs vs TE red-zone looks).
    cohortOf: (pos) => pos,
    minVolume: 30,
  },
];

export function computeRegression(
  lines: RegressionInputLine[],
  scoring: Record<string, number>
): RegressionRow[] {
  const rowById = new Map<string, RegressionRow>();

  for (const spec of PHASE_SPECS) {
    const qualifying = lines.filter(
      (l) =>
        spec.positions.has(l.position) &&
        l.gp > 0 &&
        (l.stats[spec.volKey] ?? 0) >= spec.minVolume
    );

    // Cohort rates: TD fit on overall + red-zone volume, plus aggregate
    // yards-per-opportunity and catch rate, volume-weighted by construction.
    const cohorts = new Map<string, typeof qualifying>();
    for (const l of qualifying) {
      const key = spec.cohortOf(l.position);
      const list = cohorts.get(key) ?? [];
      list.push(l);
      cohorts.set(key, list);
    }
    const rates = new Map<
      string,
      { td: { base: number; rz: number }; ypo: number; catchRate: number }
    >();
    for (const [key, members] of cohorts) {
      let vol = 0;
      let yd = 0;
      let rec = 0;
      for (const m of members) {
        vol += m.stats[spec.volKey] ?? 0;
        yd += m.stats[spec.ydKey] ?? 0;
        if (spec.recKey) rec += m.stats[spec.recKey] ?? 0;
      }
      rates.set(key, {
        td: fitTdRates(
          members.map((m) => ({
            vol: m.stats[spec.volKey] ?? 0,
            rz: Math.min(m.stats[spec.rzKey] ?? 0, m.stats[spec.volKey] ?? 0),
            td: m.stats[spec.tdKey] ?? 0,
          }))
        ),
        ypo: vol > 0 ? yd / vol : 0,
        catchRate: vol > 0 ? rec / vol : 0,
      });
    }

    for (const l of qualifying) {
      const rate = rates.get(spec.cohortOf(l.position))!;
      const vol = l.stats[spec.volKey] ?? 0;
      const rz = Math.min(l.stats[spec.rzKey] ?? 0, vol);
      const actualTd = l.stats[spec.tdKey] ?? 0;
      const actualYd = l.stats[spec.ydKey] ?? 0;
      const expTd = rate.td.base * (vol - rz) + rate.td.rz * rz;
      const expYd = rate.ypo * vol;
      const actualRec = spec.recKey ? (l.stats[spec.recKey] ?? 0) : null;
      const expRec = spec.recKey ? rate.catchRate * vol : null;
      const deltaPts =
        (actualTd - expTd) * (scoring[spec.tdScoreKey] ?? 0) +
        (actualYd - expYd) * (scoring[spec.ydScoreKey] ?? 0) +
        (actualRec != null && expRec != null
          ? (actualRec - expRec) * (scoring["rec"] ?? 0)
          : 0);

      const row =
        rowById.get(l.playerId) ??
        ({
          playerId: l.playerId,
          name: l.name,
          position: l.position,
          gp: l.gp,
          phases: [],
          deltaPts: 0,
          deltaPtsPerGame: 0,
        } satisfies RegressionRow);
      row.phases.push({
        phase: spec.phase,
        volume: vol,
        rzVolume: rz,
        actualTd,
        expTd: round2(expTd),
        actualYd,
        expYd: round2(expYd),
        actualRec,
        expRec: expRec != null ? round2(expRec) : null,
        deltaPts: round2(deltaPts),
      });
      row.deltaPts += deltaPts;
      rowById.set(l.playerId, row);
    }
  }

  const rows = [...rowById.values()].map((r) => ({
    ...r,
    deltaPts: round2(r.deltaPts),
    deltaPtsPerGame: round2(r.gp > 0 ? r.deltaPts / r.gp : 0),
  }));
  rows.sort((a, b) => b.deltaPtsPerGame - a.deltaPtsPerGame);
  return rows;
}
