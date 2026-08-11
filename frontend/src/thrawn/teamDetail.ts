/**
 * Pure helpers behind the Team Analysis deep-dive: week-by-week lineup
 * projections, bye-week congestion, durability, and injury resilience.
 */
import type { PlayerValue, ReplacementLevel } from "./types";

export const WEEKS = 18;

/** Games in a modern NFL season for one player (17 games + 1 bye). */
const MAX_GP = 17;

export const BASE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

/** Which base positions may fill each flex-style roster slot. */
export const FLEX_ELIGIBILITY: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

/**
 * League-scaled weekly projection curve (length 18). ESPN's weekly feed
 * supplies the shape (byes/ramps as zeros and dips); it's normalized and
 * multiplied by the player's effective season total so overrides and the
 * chosen projection source flow through. Players with no weekly feed are
 * spread evenly across non-bye weeks.
 */
export function weeklyPoints(v: PlayerValue): number[] {
  if (v.weekly && v.weekly.length > 0) {
    const sum = v.weekly.reduce((s, x) => s + Math.max(0, x), 0);
    if (sum > 0) {
      return Array.from({ length: WEEKS }, (_, i) =>
        Math.max(0, ((v.weekly![i] ?? 0) / sum) * v.points)
      );
    }
  }
  const activeWeeks = v.byeWeek != null ? WEEKS - 1 : WEEKS;
  const perWeek = v.points / activeWeeks;
  return Array.from({ length: WEEKS }, (_, i) =>
    v.byeWeek != null && i + 1 === v.byeWeek ? 0 : perWeek
  );
}

export type LineupResult = {
  /** Player ids seated in the lineup. */
  starterIds: Set<string>;
  /** Total points of the seated lineup. */
  total: number;
  /** Starting slots that could not be filled at all. */
  unfilled: number;
};

/**
 * Greedy best lineup for one team: dedicated slots first (best available
 * at the position), then flex slots by points among eligible leftovers.
 */
export function fillLineup(
  players: { playerId: string; position: string; pts: number }[],
  rosterPositions: string[]
): LineupResult {
  const sorted = [...players].sort((a, b) => b.pts - a.pts);
  const slotCounts = new Map<string, number>();
  for (const slot of rosterPositions) {
    slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
  }

  const starterIds = new Set<string>();
  let total = 0;
  let unfilled = 0;

  const seat = (eligible: (p: (typeof sorted)[number]) => boolean) => {
    const p = sorted.find((x) => !starterIds.has(x.playerId) && eligible(x));
    if (!p) {
      unfilled++;
      return;
    }
    starterIds.add(p.playerId);
    total += p.pts;
  };

  for (const [slot, count] of slotCounts) {
    if (!(BASE_POSITIONS as readonly string[]).includes(slot)) continue;
    for (let i = 0; i < count; i++) seat((p) => p.position === slot);
  }
  for (const [slot, count] of slotCounts) {
    const eligible = FLEX_ELIGIBILITY[slot];
    if (!eligible) continue;
    for (let i = 0; i < count; i++) {
      seat((p) => eligible.includes(p.position));
    }
  }
  return { starterIds, total, unfilled };
}

export type WeekOutlook = {
  week: number;
  /** Best-lineup projected points for the week. */
  points: number;
  /** Rostered players on bye this week. */
  byes: PlayerValue[];
  /** Season-lineup starters on bye this week. */
  starterByes: PlayerValue[];
  /** Starting slots that couldn't be filled this week. */
  unfilled: number;
};

/**
 * Week-by-week best-lineup projection for a roster, from each player's
 * league-scaled weekly curve. `starterIds` should be the season-level
 * lineup so bye congestion can be reported in terms of real starters.
 */
export function computeWeeklyOutlook(
  roster: PlayerValue[],
  rosterPositions: string[],
  starterIds: Set<string>
): WeekOutlook[] {
  const curves = new Map(roster.map((v) => [v.playerId, weeklyPoints(v)]));
  return Array.from({ length: WEEKS }, (_, i) => {
    const week = i + 1;
    const lineup = fillLineup(
      roster.map((v) => ({
        playerId: v.playerId,
        position: v.position,
        pts: curves.get(v.playerId)![i]!,
      })),
      rosterPositions
    );
    const byes = roster.filter((v) => v.byeWeek === week);
    return {
      week,
      points: lineup.total,
      byes,
      starterByes: byes.filter((v) => starterIds.has(v.playerId)),
      unfilled: lineup.unfilled,
    };
  });
}

export type Durability = {
  /** Mean games played across the past seasons on record; null = no data. */
  avgGp: number | null;
  /** Seasons of history behind the average. */
  seasons: number;
  /** avgGp / 17 clamped to [0, 1]; 1 when no history (rookies). */
  availability: number;
};

/** Injury durability from actual games played in past seasons. */
export function durability(v: PlayerValue): Durability {
  const gps = v.history.map((h) => h.gp);
  if (gps.length === 0) return { avgGp: null, seasons: 0, availability: 1 };
  const avgGp = gps.reduce((s, x) => s + x, 0) / gps.length;
  return {
    avgGp,
    seasons: gps.length,
    availability: Math.min(1, avgGp / MAX_GP),
  };
}

export type StarterRisk = {
  player: PlayerValue;
  durability: Durability;
  /** Best same-position player on the roster outside the lineup. */
  backup: PlayerValue | null;
  /** PPG of the fallback: roster backup, else the waiver replacement. */
  backupPpg: number;
  /** PPG lost while this starter is out: starter ppg - backup ppg (>=0). */
  dropoff: number;
  /** Expected PPG loss = missed-game risk x dropoff. */
  expectedLoss: number;
};

/**
 * Injury resilience: for each season-lineup starter, how much the lineup
 * loses per game if they miss time (next man up on the roster, or the
 * waiver-wire replacement when the bench is empty), weighted by their
 * historical missed-game rate.
 */
export function computeStarterRisks(
  roster: PlayerValue[],
  starterIds: Set<string>,
  replacement: ReplacementLevel[]
): StarterRisk[] {
  const replacementPpg = new Map(replacement.map((r) => [r.position, r.ppg]));
  const starters = roster
    .filter((v) => starterIds.has(v.playerId))
    .sort((a, b) => b.ppg - a.ppg);

  return starters.map((player) => {
    const backup =
      roster
        .filter(
          (v) =>
            v.position === player.position && !starterIds.has(v.playerId)
        )
        .sort((a, b) => b.ppg - a.ppg)[0] ?? null;
    const backupPpg = Math.max(
      backup?.ppg ?? 0,
      replacementPpg.get(player.position) ?? 0
    );
    const d = durability(player);
    const dropoff = Math.max(0, player.ppg - backupPpg);
    return {
      player,
      durability: d,
      backup,
      backupPpg,
      dropoff,
      expectedLoss: (1 - d.availability) * dropoff,
    };
  });
}
