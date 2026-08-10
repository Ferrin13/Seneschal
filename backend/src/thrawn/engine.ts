/**
 * Thrawn valuation engine — pure functions, no I/O.
 *
 * The central concept is Value Above Replacement (VAR): a player's projected
 * points minus the projected points of the "replacement player" at his
 * position — the best player who would be freely available once every team
 * has filled its starting lineup. Replacement level is derived from the
 * league's actual roster structure (including flex slots), which is where
 * position scarcity falls out naturally: a modest TE can out-VAR a big WR
 * because TE replacement level is so much lower.
 */

export type EnginePlayerInput = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
  age: number | null;
  /** League-scored points from the public projection (before overrides). */
  basePoints: number;
  /** User override of projected points; null = use basePoints. */
  overridePoints: number | null;
  overrideNote: string | null;
  /** Average draft position (PPR) for reference; null when unknown. */
  adp: number | null;
  /** Roster this player belongs to; null = free agent. */
  rosterId: number | null;
};

export type PlayerValue = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
  age: number | null;
  basePoints: number;
  /** Effective projected points (override when present, else base). */
  points: number;
  overridden: boolean;
  overrideNote: string | null;
  adp: number | null;
  rosterId: number | null;
  /** 1-based rank within the position by effective points. */
  positionRank: number;
  replacementPoints: number;
  /** Value above replacement: points - replacementPoints. */
  var: number;
  /** 1-based rank by VAR among rostered players only; null for free agents. */
  keeperRank: number | null;
  /** True when this rostered player sits inside the league's keeper slots. */
  keeperLevel: boolean;
};

export type ReplacementLevel = {
  position: string;
  /** How many players at this position start league-wide (incl. flex share). */
  starterSlots: number;
  /** Projected points of the replacement player (first non-starter). */
  points: number;
  /** The replacement player himself, for display. */
  playerId: string | null;
  playerName: string | null;
};

export type ValuationResult = {
  values: PlayerValue[];
  replacement: ReplacementLevel[];
  /** Total keeper slots league-wide (maxKeepers * numTeams). */
  keeperSlots: number;
  /** VAR of the last player inside the keeper slots (the keeper line). */
  keeperLineVar: number | null;
};

/** Which base positions may fill each flex-style roster slot. */
const FLEX_ELIGIBILITY: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

const BASE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

/**
 * League-accurate fantasy points for a stat-level projection: the sum over
 * every scoring category of (projected stat) x (points per unit). Stat keys
 * in Sleeper projections line up with scoring_settings keys, and non-scoring
 * keys (adp_*, pts_*, gp) are simply never looked up.
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
  return Math.round(total * 100) / 100;
}

/**
 * Compute per-position replacement levels from the league's roster structure.
 *
 * Dedicated slots (QB, RB, ... rows in roster_positions) consume the top
 * players of each position. Flex slots are then filled greedily league-wide:
 * repeatedly take the best remaining player eligible for any unfilled flex
 * slot. The replacement player at a position is the best player left after
 * all starters are seated.
 */
function computeReplacementLevels(
  players: { playerId: string; name: string; position: string; points: number }[],
  rosterPositions: string[],
  numTeams: number
): Map<string, ReplacementLevel> {
  // Sorted pools per position, best first.
  const pools = new Map<string, { playerId: string; name: string; points: number }[]>();
  for (const p of players) {
    if (!BASE_POSITIONS.has(p.position)) continue;
    const pool = pools.get(p.position) ?? [];
    pool.push({ playerId: p.playerId, name: p.name, points: p.points });
    pools.set(p.position, pool);
  }
  for (const pool of pools.values()) pool.sort((a, b) => b.points - a.points);

  // Count roster slots per kind.
  const slotCounts = new Map<string, number>();
  for (const slot of rosterPositions) {
    if (slot === "BN" || slot === "IR" || slot === "TAXI") continue;
    slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
  }

  // Consumed[pos] = how many players at pos are seated as starters so far.
  const consumed = new Map<string, number>();
  for (const pos of pools.keys()) consumed.set(pos, 0);

  for (const [slot, count] of slotCounts) {
    if (BASE_POSITIONS.has(slot)) {
      consumed.set(slot, (consumed.get(slot) ?? 0) + count * numTeams);
    }
  }

  // Greedy flex fill: each flex seat takes the best remaining eligible player.
  for (const [slot, count] of slotCounts) {
    const eligible = FLEX_ELIGIBILITY[slot];
    if (!eligible) continue;
    let seats = count * numTeams;
    while (seats > 0) {
      let bestPos: string | null = null;
      let bestPoints = -Infinity;
      for (const pos of eligible) {
        const pool = pools.get(pos);
        if (!pool) continue;
        const idx = consumed.get(pos) ?? 0;
        const next = pool[idx];
        if (next && next.points > bestPoints) {
          bestPoints = next.points;
          bestPos = pos;
        }
      }
      if (!bestPos) break;
      consumed.set(bestPos, (consumed.get(bestPos) ?? 0) + 1);
      seats--;
    }
  }

  const result = new Map<string, ReplacementLevel>();
  for (const [pos, pool] of pools) {
    const starterSlots = consumed.get(pos) ?? 0;
    const replacement = pool[starterSlots] ?? pool[pool.length - 1] ?? null;
    result.set(pos, {
      position: pos,
      starterSlots,
      points: replacement?.points ?? 0,
      playerId: replacement?.playerId ?? null,
      playerName: replacement?.name ?? null,
    });
  }
  return result;
}

export function computeValuation(
  players: EnginePlayerInput[],
  opts: {
    rosterPositions: string[];
    numTeams: number;
    maxKeepers: number;
  }
): ValuationResult {
  const effective = players
    .filter((p) => BASE_POSITIONS.has(p.position))
    .map((p) => ({
      ...p,
      points: p.overridePoints ?? p.basePoints,
    }));

  const replacementByPos = computeReplacementLevels(
    effective.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      points: p.points,
    })),
    opts.rosterPositions,
    opts.numTeams
  );

  // Position ranks by effective points.
  const byPosition = new Map<string, typeof effective>();
  for (const p of effective) {
    const list = byPosition.get(p.position) ?? [];
    list.push(p);
    byPosition.set(p.position, list);
  }
  const positionRank = new Map<string, number>();
  for (const list of byPosition.values()) {
    list.sort((a, b) => b.points - a.points);
    list.forEach((p, i) => positionRank.set(p.playerId, i + 1));
  }

  const values: PlayerValue[] = effective.map((p) => {
    const repl = replacementByPos.get(p.position);
    const replPoints = repl?.points ?? 0;
    return {
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      team: p.team,
      injuryStatus: p.injuryStatus,
      age: p.age,
      basePoints: p.basePoints,
      points: p.points,
      overridden: p.overridePoints != null,
      overrideNote: p.overrideNote,
      adp: p.adp,
      rosterId: p.rosterId,
      positionRank: positionRank.get(p.playerId) ?? 0,
      replacementPoints: replPoints,
      var: Math.round((p.points - replPoints) * 100) / 100,
      keeperRank: null,
      keeperLevel: false,
    };
  });

  // Keeper line: rank rostered players by VAR; the top (maxKeepers * numTeams)
  // are "keeper level".
  const keeperSlots = opts.maxKeepers * opts.numTeams;
  const rostered = values
    .filter((v) => v.rosterId != null)
    .sort((a, b) => b.var - a.var);
  rostered.forEach((v, i) => {
    v.keeperRank = i + 1;
    v.keeperLevel = i < keeperSlots;
  });
  const keeperLineVar =
    rostered.length >= keeperSlots && keeperSlots > 0
      ? rostered[keeperSlots - 1]!.var
      : null;

  values.sort((a, b) => b.var - a.var);

  return {
    values,
    replacement: [...replacementByPos.values()].sort((a, b) =>
      a.position.localeCompare(b.position)
    ),
    keeperSlots,
    keeperLineVar,
  };
}
