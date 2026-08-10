import { and, eq, max, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  thrawnLeagues,
  thrawnOverrides,
  thrawnPlayers,
  thrawnProjections,
  thrawnTeams,
  type NewThrawnPlayer,
  type NewThrawnProjection,
  type ThrawnLeague,
  type ThrawnLeagueSettings,
} from "../db/schema.js";
import {
  computeValuation,
  scoreProjection,
  type EnginePlayerInput,
  type ValuationResult,
} from "./engine.js";
import {
  FANTASY_POSITIONS,
  fetchLeague,
  fetchLeagueUsers,
  fetchPlayersDump,
  fetchRosters,
  fetchSeasonProjections,
  type SleeperLeague,
} from "./sleeper.js";

export class ThrawnError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** How stale the shared players/projections catalog may get before a resync. */
const CATALOG_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const FANTASY_POSITION_SET = new Set<string>(FANTASY_POSITIONS);

function leagueSettingsFromSleeper(league: SleeperLeague): ThrawnLeagueSettings {
  return {
    scoring: league.scoring_settings ?? {},
    rosterPositions: league.roster_positions ?? [],
    numTeams: league.settings?.num_teams ?? league.total_rosters,
    maxKeepers: league.settings?.max_keepers ?? 0,
  };
}

async function chunkedUpsert<T>(
  rows: T[],
  size: number,
  insertChunk: (chunk: T[]) => Promise<void>
) {
  for (let i = 0; i < rows.length; i += size) {
    await insertChunk(rows.slice(i, i + size));
  }
}

/**
 * Refresh the shared player dictionary + season projections when stale.
 * Sleeper asks that the 5MB players dump be fetched at most daily, so both
 * feeds are cached and only re-pulled after CATALOG_MAX_AGE_MS (or when the
 * season has no projections yet).
 */
export async function ensureCatalog(season: string, force = false): Promise<void> {
  if (!force) {
    const [row] = await db
      .select({ latest: max(thrawnProjections.updatedAt) })
      .from(thrawnProjections)
      .where(eq(thrawnProjections.season, season));
    const latest = row?.latest;
    if (latest && Date.now() - latest.getTime() < CATALOG_MAX_AGE_MS) return;
  }

  const [dump, projections] = await Promise.all([
    fetchPlayersDump(),
    fetchSeasonProjections(season),
  ]);

  const now = new Date();
  const playerRows: NewThrawnPlayer[] = [];
  for (const entry of Object.values(dump)) {
    const pos = entry.position;
    if (!pos || !FANTASY_POSITION_SET.has(pos)) continue;
    playerRows.push({
      id: entry.player_id,
      firstName: entry.first_name ?? "",
      lastName: entry.last_name ?? "",
      position: pos,
      team: entry.team,
      age: entry.age,
      status: entry.status,
      injuryStatus: entry.injury_status,
      yearsExp: entry.years_exp,
      updatedAt: now,
    });
  }

  await chunkedUpsert(playerRows, 500, async (chunk) => {
    await db
      .insert(thrawnPlayers)
      .values(chunk)
      .onConflictDoUpdate({
        target: thrawnPlayers.id,
        set: {
          firstName: sql`excluded.first_name`,
          lastName: sql`excluded.last_name`,
          position: sql`excluded.position`,
          team: sql`excluded.team`,
          age: sql`excluded.age`,
          status: sql`excluded.status`,
          injuryStatus: sql`excluded.injury_status`,
          yearsExp: sql`excluded.years_exp`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  });

  const knownIds = new Set(playerRows.map((r) => r.id));
  const projectionRows: NewThrawnProjection[] = [];
  const seenProjection = new Set<string>();
  for (const entry of projections) {
    if (!entry.stats || !entry.player_id) continue;
    // Season-long feed only; skip weekly rows if the feed ever includes them.
    if (entry.week != null) continue;
    if (!knownIds.has(entry.player_id)) continue;
    if (seenProjection.has(entry.player_id)) continue;
    seenProjection.add(entry.player_id);
    const adp = entry.stats.adp_ppr;
    projectionRows.push({
      source: "sleeper",
      season,
      playerId: entry.player_id,
      stats: entry.stats,
      ptsPpr: entry.stats.pts_ppr ?? null,
      adpPpr: adp != null && adp < 999 ? adp : null,
      updatedAt: now,
    });
  }

  await chunkedUpsert(projectionRows, 200, async (chunk) => {
    await db
      .insert(thrawnProjections)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          thrawnProjections.source,
          thrawnProjections.season,
          thrawnProjections.playerId,
        ],
        set: {
          stats: sql`excluded.stats`,
          ptsPpr: sql`excluded.pts_ppr`,
          adpPpr: sql`excluded.adp_ppr`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  });
}

/** Pull league + rosters + users from Sleeper and refresh our snapshot. */
async function syncLeagueData(leagueRow: ThrawnLeague): Promise<ThrawnLeague> {
  const [league, rosters, users] = await Promise.all([
    fetchLeague(leagueRow.sleeperLeagueId),
    fetchRosters(leagueRow.sleeperLeagueId),
    fetchLeagueUsers(leagueRow.sleeperLeagueId),
  ]);

  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const now = new Date();

  for (const roster of rosters) {
    const owner = roster.owner_id ? usersById.get(roster.owner_id) : undefined;
    const values = {
      leagueId: leagueRow.id,
      rosterId: roster.roster_id,
      ownerId: roster.owner_id,
      displayName: owner?.display_name ?? null,
      teamName: owner?.metadata?.team_name ?? null,
      avatar: owner?.avatar ?? null,
      players: roster.players ?? [],
      starters: roster.starters ?? [],
      keepers: roster.keepers ?? [],
      updatedAt: now,
    };
    await db
      .insert(thrawnTeams)
      .values(values)
      .onConflictDoUpdate({
        target: [thrawnTeams.leagueId, thrawnTeams.rosterId],
        set: {
          ownerId: values.ownerId,
          displayName: values.displayName,
          teamName: values.teamName,
          avatar: values.avatar,
          players: values.players,
          starters: values.starters,
          keepers: values.keepers,
          updatedAt: now,
        },
      });
  }

  const [updated] = await db
    .update(thrawnLeagues)
    .set({
      name: league.name,
      season: league.season,
      settings: leagueSettingsFromSleeper(league),
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(thrawnLeagues.id, leagueRow.id))
    .returning();

  await ensureCatalog(league.season);
  return updated!;
}

export async function listLeagues(userId: string) {
  return db
    .select()
    .from(thrawnLeagues)
    .where(eq(thrawnLeagues.userId, userId))
    .orderBy(thrawnLeagues.createdAt);
}

export async function getLeague(userId: string, leagueId: string) {
  const [row] = await db
    .select()
    .from(thrawnLeagues)
    .where(and(eq(thrawnLeagues.id, leagueId), eq(thrawnLeagues.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createLeague(userId: string, sleeperLeagueId: string) {
  const existing = await db
    .select()
    .from(thrawnLeagues)
    .where(
      and(
        eq(thrawnLeagues.userId, userId),
        eq(thrawnLeagues.sleeperLeagueId, sleeperLeagueId)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    throw new ThrawnError("already_exists", "League is already tracked", 409);
  }

  let league: SleeperLeague;
  try {
    league = await fetchLeague(sleeperLeagueId);
  } catch {
    throw new ThrawnError(
      "sleeper_not_found",
      "Could not fetch that league from Sleeper — check the league ID",
      404
    );
  }

  const [row] = await db
    .insert(thrawnLeagues)
    .values({
      userId,
      sleeperLeagueId,
      name: league.name,
      season: league.season,
      settings: leagueSettingsFromSleeper(league),
    })
    .returning();

  return syncLeagueData(row!);
}

export async function syncLeague(userId: string, leagueId: string) {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);
  return syncLeagueData(league);
}

export async function updateLeague(
  userId: string,
  leagueId: string,
  patch: { myRosterId?: number | null }
) {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);
  const [updated] = await db
    .update(thrawnLeagues)
    .set({ myRosterId: patch.myRosterId, updatedAt: new Date() })
    .where(eq(thrawnLeagues.id, leagueId))
    .returning();
  return updated!;
}

export async function deleteLeague(userId: string, leagueId: string) {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);
  await db.delete(thrawnLeagues).where(eq(thrawnLeagues.id, leagueId));
}

export type LeagueValuesSnapshot = {
  league: {
    id: string;
    sleeperLeagueId: string;
    name: string;
    season: string;
    settings: ThrawnLeagueSettings;
    myRosterId: number | null;
    lastSyncedAt: string | null;
  };
  teams: {
    rosterId: number;
    ownerId: string | null;
    displayName: string | null;
    teamName: string | null;
    avatar: string | null;
    players: string[];
    keepers: string[];
  }[];
  valuation: ValuationResult;
};

/** How many unrostered players (by points) to include as free agents. */
const FREE_AGENT_LIMIT = 150;

/**
 * The one big read: league + teams + every relevant player valued under the
 * league's scoring, with the user's overrides applied and VAR computed over
 * the full player pool (rostered + free agents).
 */
export async function getLeagueValues(
  userId: string,
  leagueId: string
): Promise<LeagueValuesSnapshot> {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);

  const teams = await db
    .select()
    .from(thrawnTeams)
    .where(eq(thrawnTeams.leagueId, leagueId))
    .orderBy(thrawnTeams.rosterId);

  const projectionRows = await db
    .select({
      playerId: thrawnProjections.playerId,
      stats: thrawnProjections.stats,
      adpPpr: thrawnProjections.adpPpr,
      firstName: thrawnPlayers.firstName,
      lastName: thrawnPlayers.lastName,
      position: thrawnPlayers.position,
      team: thrawnPlayers.team,
      age: thrawnPlayers.age,
      injuryStatus: thrawnPlayers.injuryStatus,
    })
    .from(thrawnProjections)
    .innerJoin(thrawnPlayers, eq(thrawnProjections.playerId, thrawnPlayers.id))
    .where(
      and(
        eq(thrawnProjections.season, league.season),
        eq(thrawnProjections.source, "sleeper")
      )
    );

  const overrides = await db
    .select()
    .from(thrawnOverrides)
    .where(
      and(
        eq(thrawnOverrides.userId, userId),
        eq(thrawnOverrides.season, league.season)
      )
    );
  const overrideByPlayer = new Map(overrides.map((o) => [o.playerId, o]));

  const rosterByPlayer = new Map<string, number>();
  for (const team of teams) {
    for (const pid of team.players) rosterByPlayer.set(pid, team.rosterId);
  }

  const scoring = league.settings.scoring;
  const candidates: EnginePlayerInput[] = [];
  for (const row of projectionRows) {
    if (!row.position) continue;
    const override = overrideByPlayer.get(row.playerId);
    candidates.push({
      playerId: row.playerId,
      name: `${row.firstName} ${row.lastName}`.trim(),
      position: row.position,
      team: row.team,
      injuryStatus: row.injuryStatus,
      age: row.age,
      basePoints: scoreProjection(row.stats, scoring),
      overridePoints: override?.points ?? null,
      overrideNote: override?.note ?? null,
      adp: row.adpPpr,
      rosterId: rosterByPlayer.get(row.playerId) ?? null,
    });
  }

  // Keep every rostered player, but cap free agents to the ones that matter.
  // The full pool (before capping) feeds the replacement-level calc, so trim
  // AFTER valuation would be ideal — instead keep enough FAs that replacement
  // levels are unaffected (replacement ranks are always well under this cap
  // per position).
  const rostered = candidates.filter((c) => c.rosterId != null);
  const freeAgents = candidates
    .filter((c) => c.rosterId == null)
    .sort(
      (a, b) => (b.overridePoints ?? b.basePoints) - (a.overridePoints ?? a.basePoints)
    )
    .slice(0, FREE_AGENT_LIMIT);

  const valuation = computeValuation([...rostered, ...freeAgents], {
    rosterPositions: league.settings.rosterPositions,
    numTeams: league.settings.numTeams,
    maxKeepers: league.settings.maxKeepers,
  });

  return {
    league: {
      id: league.id,
      sleeperLeagueId: league.sleeperLeagueId,
      name: league.name,
      season: league.season,
      settings: league.settings,
      myRosterId: league.myRosterId,
      lastSyncedAt: league.lastSyncedAt ? league.lastSyncedAt.toISOString() : null,
    },
    teams: teams.map((t) => ({
      rosterId: t.rosterId,
      ownerId: t.ownerId,
      displayName: t.displayName,
      teamName: t.teamName,
      avatar: t.avatar,
      players: t.players,
      keepers: t.keepers,
    })),
    valuation,
  };
}

/** Upsert (points != null) or clear (points == null) a projection override. */
export async function setOverride(
  userId: string,
  leagueId: string,
  playerId: string,
  points: number | null,
  note: string | null
) {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);

  if (points == null) {
    await db
      .delete(thrawnOverrides)
      .where(
        and(
          eq(thrawnOverrides.userId, userId),
          eq(thrawnOverrides.season, league.season),
          eq(thrawnOverrides.playerId, playerId)
        )
      );
    return { cleared: true as const };
  }

  const now = new Date();
  const [row] = await db
    .insert(thrawnOverrides)
    .values({ userId, season: league.season, playerId, points, note })
    .onConflictDoUpdate({
      target: [
        thrawnOverrides.userId,
        thrawnOverrides.season,
        thrawnOverrides.playerId,
      ],
      set: { points, note, updatedAt: now },
    })
    .returning();
  return row!;
}
