import { and, count, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  thrawnLeagues,
  thrawnMatchups,
  thrawnOverrides,
  thrawnPlayers,
  thrawnPlayerStats,
  thrawnProjections,
  thrawnSeasonTeams,
  thrawnTeams,
  type NewThrawnMatchup,
  type NewThrawnPlayer,
  type NewThrawnPlayerStats,
  type NewThrawnProjection,
  type NewThrawnSeasonTeam,
  type ThrawnLeague,
  type ThrawnLeagueSettings,
  type ThrawnProjectionSource,
} from "../db/schema.js";
import {
  buildPlayerIndex,
  fetchEspnByeWeeks,
  fetchEspnProjections,
  fetchSharksProjections,
  matchPlayerId,
} from "./sources.js";
import {
  computeRegression,
  computeSeasonLuck,
  computeValuation,
  positionCountsFromAdp,
  positionCountsFromRosters,
  replacementLevels,
  scoreProjection,
  type EnginePlayerInput,
  type RegressionRow,
  type ReplacementLevel,
  type SeasonHistoryInput,
  type TeamSeasonLuck,
  type ValuationResult,
} from "./engine.js";
import {
  FANTASY_POSITIONS,
  fetchLeague,
  fetchLeagueUsers,
  fetchMatchups,
  fetchPlayersDump,
  fetchRosters,
  fetchSeasonProjections,
  fetchSeasonStats,
  type SleeperLeague,
} from "./sleeper.js";

export class ThrawnError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** How stale the shared players/projections catalog may get before a resync. */
const CATALOG_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Projection feeds that are synced into thrawn_projections. */
export const PROJECTION_SOURCES = ["sleeper", "espn", "sharks"] as const;

/** Positions whose Sleeper projections are missing whole stat categories. */
const SLEEPER_INCOMPLETE_POSITIONS = new Set(["K", "DEF"]);

/** How many past seasons of actual stats feed the historical PAR view. */
const HISTORY_SEASONS = 3;

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

/** Sources whose newest row for the season is older than the cache window. */
async function staleSources(season: string): Promise<Set<string>> {
  const rows = await db
    .select({
      source: thrawnProjections.source,
      latest: max(thrawnProjections.updatedAt),
    })
    .from(thrawnProjections)
    .where(eq(thrawnProjections.season, season))
    .groupBy(thrawnProjections.source);
  const latestBySource = new Map(rows.map((r) => [r.source, r.latest]));
  const stale = new Set<string>();
  for (const source of PROJECTION_SOURCES) {
    const latest = latestBySource.get(source);
    if (!latest || Date.now() - latest.getTime() >= CATALOG_MAX_AGE_MS) {
      stale.add(source);
    }
  }
  return stale;
}

async function upsertProjections(rows: NewThrawnProjection[]): Promise<void> {
  await chunkedUpsert(rows, 200, async (chunk) => {
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
          weekly: sql`excluded.weekly`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  });
}

/**
 * Refresh the shared player dictionary + season projections when stale.
 * Sleeper asks that the 5MB players dump be fetched at most daily, so every
 * feed is cached and only re-pulled after CATALOG_MAX_AGE_MS (or when the
 * season has no rows for that source yet). ESPN and FantasySharks failures
 * are logged and skipped so a flaky third-party feed can't break a sync.
 */
export async function ensureCatalog(season: string, force = false): Promise<void> {
  const stale = force
    ? new Set<string>(PROJECTION_SOURCES)
    : await staleSources(season);

  let knownIds: Set<string> | null = null;
  if (stale.has("sleeper")) {
    knownIds = await syncSleeperCatalog(season);
  }
  for (const source of ["espn", "sharks"] as const) {
    if (!stale.has(source)) continue;
    try {
      await syncExternalProjections(source, season);
    } catch (err) {
      console.warn(`thrawn: ${source} projection sync failed`, err);
    }
  }

  // Past-season stats sync once per season, independent of freshness.
  await ensureSeasonStats(season, knownIds);
}

/** Sync the Sleeper players dump + projections; returns known player ids. */
async function syncSleeperCatalog(season: string): Promise<Set<string>> {
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

  await upsertProjections(projectionRows);
  return knownIds;
}

/**
 * Sync an external projection feed (ESPN / FantasySharks), matching players
 * to Sleeper ids by name + position (+ team tiebreak). Defenses match by
 * team code directly since Sleeper's DEF ids are team codes.
 */
async function syncExternalProjections(
  source: "espn" | "sharks",
  season: string
): Promise<void> {
  const entries =
    source === "espn"
      ? await fetchEspnProjections(season)
      : await fetchSharksProjections();

  const players = await db
    .select({
      id: thrawnPlayers.id,
      firstName: thrawnPlayers.firstName,
      lastName: thrawnPlayers.lastName,
      position: thrawnPlayers.position,
      team: thrawnPlayers.team,
    })
    .from(thrawnPlayers);
  const index = buildPlayerIndex(players);
  const knownIds = new Set(players.map((p) => p.id));

  const now = new Date();
  const rows: NewThrawnProjection[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const playerId =
      entry.position === "DEF"
        ? entry.team && knownIds.has(entry.team)
          ? entry.team
          : null
        : matchPlayerId(index, entry.name, entry.position, entry.team);
    if (!playerId || seen.has(playerId)) continue;
    seen.add(playerId);
    rows.push({
      source,
      season,
      playerId,
      stats: entry.stats,
      ptsPpr: null,
      adpPpr: null,
      weekly: entry.weekly,
      updatedAt: now,
    });
  }
  await upsertProjections(rows);

  // ESPN also knows this season's NFL bye weeks; store them on the player
  // dictionary so lineup projections can zero out bye weeks.
  if (source === "espn") {
    const byes = await fetchEspnByeWeeks(season);
    for (const [team, byeWeek] of Object.entries(byes)) {
      await db
        .update(thrawnPlayers)
        .set({ byeWeek })
        .where(eq(thrawnPlayers.team, team));
    }
  }
}

/** Past seasons relative to the given one, newest first. */
function pastSeasons(season: string): string[] {
  const year = Number(season);
  if (!Number.isFinite(year)) return [];
  return Array.from({ length: HISTORY_SEASONS }, (_, i) => String(year - 1 - i));
}

/**
 * Sync actual stats for the past HISTORY_SEASONS seasons. Finished seasons
 * never change, so a season is fetched only when we have no rows for it.
 * `knownPlayerIds` may be passed when the caller already has the dump in
 * hand; otherwise the player dictionary is read from the database.
 */
async function ensureSeasonStats(
  season: string,
  knownPlayerIds: Set<string> | null
): Promise<void> {
  for (const past of pastSeasons(season)) {
    const [row] = await db
      .select({ n: count() })
      .from(thrawnPlayerStats)
      .where(eq(thrawnPlayerStats.season, past));
    if ((row?.n ?? 0) > 0) continue;

    if (!knownPlayerIds) {
      const ids = await db.select({ id: thrawnPlayers.id }).from(thrawnPlayers);
      knownPlayerIds = new Set(ids.map((r) => r.id));
    }
    const entries = await fetchSeasonStats(past);
    const now = new Date();
    const seen = new Set<string>();
    const rows: NewThrawnPlayerStats[] = [];
    for (const entry of entries) {
      if (!entry.stats || !entry.player_id) continue;
      if (entry.week != null) continue;
      if (!knownPlayerIds.has(entry.player_id)) continue;
      if (seen.has(entry.player_id)) continue;
      seen.add(entry.player_id);
      const gp = Math.round(entry.stats.gp ?? 0);
      if (gp <= 0) continue;
      rows.push({
        season: past,
        playerId: entry.player_id,
        stats: entry.stats,
        gp,
        ptsPpr: entry.stats.pts_ppr ?? null,
        updatedAt: now,
      });
    }

    await chunkedUpsert(rows, 200, async (chunk) => {
      await db
        .insert(thrawnPlayerStats)
        .values(chunk)
        .onConflictDoNothing();
    });
  }
}

/**
 * Sync past-season history by walking the league's previous_league_id chain
 * (Sleeper mints a new league id every season). Two things are captured per
 * past season, each fetched only once since finished seasons never change:
 *
 *  - final rosters + team identities (thrawn_season_teams), so historical
 *    views can show the roster as it existed that year;
 *  - weekly matchup scores for regular-season weeks only (thrawn_matchups) —
 *    playoff brackets aren't scheduled fairly, so they'd pollute the luck
 *    numbers.
 */
async function ensureSeasonHistory(
  leagueRow: ThrawnLeague,
  currentLeague: SleeperLeague
): Promise<void> {
  let prevId = currentLeague.previous_league_id;
  for (let i = 0; i < HISTORY_SEASONS && prevId; i++) {
    const prev = await fetchLeague(prevId);
    const seasonFilter = (table: typeof thrawnMatchups | typeof thrawnSeasonTeams) =>
      and(eq(table.leagueId, leagueRow.id), eq(table.season, prev.season));
    const [[matchupCount], [teamCount]] = await Promise.all([
      db.select({ n: count() }).from(thrawnMatchups).where(seasonFilter(thrawnMatchups)),
      db.select({ n: count() }).from(thrawnSeasonTeams).where(seasonFilter(thrawnSeasonTeams)),
    ]);
    const needMatchups = (matchupCount?.n ?? 0) === 0;
    const needTeams = (teamCount?.n ?? 0) === 0;

    if (needMatchups || needTeams) {
      const [rosters, users] = await Promise.all([
        fetchRosters(prevId),
        fetchLeagueUsers(prevId),
      ]);
      const usersById = new Map(users.map((u) => [u.user_id, u]));
      const now = new Date();

      if (needTeams) {
        const teamRows: NewThrawnSeasonTeam[] = rosters.map((r) => {
          const owner = r.owner_id ? usersById.get(r.owner_id) : undefined;
          return {
            leagueId: leagueRow.id,
            season: prev.season,
            rosterId: r.roster_id,
            ownerId: r.owner_id,
            displayName: owner?.display_name ?? null,
            teamName: owner?.metadata?.team_name ?? null,
            avatar: owner?.avatar ?? null,
            players: r.players ?? [],
            updatedAt: now,
          };
        });
        await chunkedUpsert(teamRows, 100, async (chunk) => {
          await db.insert(thrawnSeasonTeams).values(chunk).onConflictDoNothing();
        });
      }

      if (needMatchups) {
        const ownerByRoster = new Map(
          rosters.map((r) => [r.roster_id, r.owner_id])
        );
        const playoffStart = prev.settings?.playoff_week_start;
        const lastRegularWeek =
          playoffStart != null && playoffStart > 1 ? playoffStart - 1 : 14;
        const weeks = Array.from({ length: lastRegularWeek }, (_, w) => w + 1);
        const perWeek = await Promise.all(
          weeks.map((w) => fetchMatchups(prevId!, w))
        );
        const rows: NewThrawnMatchup[] = [];
        for (let w = 0; w < weeks.length; w++) {
          for (const entry of perWeek[w] ?? []) {
            rows.push({
              leagueId: leagueRow.id,
              season: prev.season,
              week: weeks[w]!,
              rosterId: entry.roster_id,
              ownerId: ownerByRoster.get(entry.roster_id) ?? null,
              matchupId: entry.matchup_id,
              points: entry.points ?? 0,
              updatedAt: now,
            });
          }
        }
        await chunkedUpsert(rows, 200, async (chunk) => {
          await db.insert(thrawnMatchups).values(chunk).onConflictDoNothing();
        });
      }
    }
    prevId = prev.previous_league_id;
  }
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
  await ensureSeasonHistory(updated!, league);
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
  patch: {
    myRosterId?: number | null;
    projectionSource?: ThrawnProjectionSource;
  }
) {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);
  const set: Partial<typeof thrawnLeagues.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.myRosterId !== undefined) set.myRosterId = patch.myRosterId;
  if (patch.projectionSource !== undefined) {
    set.projectionSource = patch.projectionSource;
  }
  const [updated] = await db
    .update(thrawnLeagues)
    .set(set)
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
    projectionSource: ThrawnProjectionSource;
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
  /** Past seasons with real roster snapshots available, newest first. */
  rosterHistorySeasons: string[];
  /** Projection sources with data for this season (subset of all feeds). */
  availableSources: string[];
};

/**
 * How many unrostered players (by points) to include as free agents. Must be
 * deep enough that every position still has players beyond fringe-bench
 * depth, since that's where the replacement level sits.
 */
const FREE_AGENT_LIMIT = 250;

/**
 * The one big read: league + teams + every relevant player valued under the
 * league's scoring, with the user's overrides applied and PAR computed over
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
      source: thrawnProjections.source,
      playerId: thrawnProjections.playerId,
      stats: thrawnProjections.stats,
      adpPpr: thrawnProjections.adpPpr,
      weekly: thrawnProjections.weekly,
      firstName: thrawnPlayers.firstName,
      lastName: thrawnPlayers.lastName,
      position: thrawnPlayers.position,
      team: thrawnPlayers.team,
      age: thrawnPlayers.age,
      injuryStatus: thrawnPlayers.injuryStatus,
      byeWeek: thrawnPlayers.byeWeek,
    })
    .from(thrawnProjections)
    .innerJoin(thrawnPlayers, eq(thrawnProjections.playerId, thrawnPlayers.id))
    .where(
      and(
        eq(thrawnProjections.season, league.season),
        inArray(thrawnProjections.source, [...PROJECTION_SOURCES])
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

  // Actual stat lines for the past seasons, scored with this league's
  // scoring. The engine needs the full per-season population (not just
  // rostered players) to place each season's replacement level.
  const seasons = pastSeasons(league.season);
  const statRows = seasons.length
    ? await db
        .select({
          season: thrawnPlayerStats.season,
          playerId: thrawnPlayerStats.playerId,
          stats: thrawnPlayerStats.stats,
          gp: thrawnPlayerStats.gp,
          position: thrawnPlayers.position,
        })
        .from(thrawnPlayerStats)
        .innerJoin(
          thrawnPlayers,
          eq(thrawnPlayerStats.playerId, thrawnPlayers.id)
        )
        .where(inArray(thrawnPlayerStats.season, seasons))
    : [];

  const rosterByPlayer = new Map<string, number>();
  for (const team of teams) {
    for (const pid of team.players) rosterByPlayer.set(pid, team.rosterId);
  }

  const scoring = league.settings.scoring;

  const historyBySeason = new Map<string, SeasonHistoryInput>();
  for (const s of seasons) historyBySeason.set(s, { season: s, players: [] });
  for (const row of statRows) {
    if (!row.position || row.gp <= 0) continue;
    historyBySeason.get(row.season)?.players.push({
      playerId: row.playerId,
      position: row.position,
      points: scoreProjection(row.stats, scoring),
      gp: row.gp,
    });
  }
  const history = [...historyBySeason.values()].filter(
    (h) => h.players.length > 0
  );

  // Group per player across sources: each source's league-scored points,
  // with games and ADP taken from the Sleeper feed when available.
  type GroupedProjection = {
    row: (typeof projectionRows)[number];
    sourcePoints: Record<string, number>;
    gp: number | null;
    adp: number | null;
    weekly: number[] | null;
  };
  const grouped = new Map<string, GroupedProjection>();
  const availableSources = new Set<string>();
  for (const row of projectionRows) {
    if (!row.position) continue;
    availableSources.add(row.source);
    let g = grouped.get(row.playerId);
    if (!g) {
      g = { row, sourcePoints: {}, gp: null, adp: null, weekly: null };
      grouped.set(row.playerId, g);
    }
    g.sourcePoints[row.source] = scoreProjection(row.stats, scoring);
    if (row.weekly && row.weekly.length > 0) g.weekly = row.weekly;
    const gp = row.stats.gp;
    // The feeds project a full season for players but Sleeper reports gp=1
    // for DEF units; treat implausibly small values as unknown.
    const plausibleGp = gp != null && gp >= 8 && gp <= 18 ? gp : null;
    if (row.source === "sleeper") {
      if (plausibleGp != null) g.gp = plausibleGp;
      g.adp = row.adpPpr;
    } else if (g.gp == null && plausibleGp != null) {
      g.gp = plausibleGp;
    }
  }

  // Sleeper's projection feed omits whole scoring categories for kickers
  // (only 40-49yd FGs and XPs) and defenses (no TDs or points-allowed
  // buckets), pricing them at roughly half their real value. Drop those
  // lines whenever a complete feed exists so the average — and a "sleeper"
  // selection, via its missing-source fallback — prices K/DEF off ESPN and
  // FantasySharks instead. ADP and games still come from the Sleeper row.
  for (const g of grouped.values()) {
    if (
      SLEEPER_INCOMPLETE_POSITIONS.has(g.row.position!) &&
      g.sourcePoints.sleeper != null &&
      Object.keys(g.sourcePoints).length > 1
    ) {
      delete g.sourcePoints.sleeper;
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const selectedSource = league.projectionSource;
  const candidates: EnginePlayerInput[] = [];
  for (const g of grouped.values()) {
    const row = g.row;
    const override = overrideByPlayer.get(row.playerId);
    const points = Object.values(g.sourcePoints);
    const average = points.reduce((s, x) => s + x, 0) / points.length;
    // A specific source falls back to the average of whatever is available,
    // so players missing from one feed don't vanish from the board.
    const basePoints =
      selectedSource === "average"
        ? average
        : g.sourcePoints[selectedSource] ?? average;
    const rosterId = rosterByPlayer.get(row.playerId) ?? null;
    candidates.push({
      playerId: row.playerId,
      name: `${row.firstName} ${row.lastName}`.trim(),
      position: row.position!,
      team: row.team,
      injuryStatus: row.injuryStatus,
      age: row.age,
      basePoints: round2(basePoints),
      gamesProj: g.gp ?? 17,
      overridePoints: override?.points ?? null,
      overrideNote: override?.note ?? null,
      adp: g.adp,
      rosterId,
      sourcePoints: g.sourcePoints,
      byeWeek: row.byeWeek,
      // Weekly shape is only needed for team analysis, so keep the payload
      // lean by attaching it to rostered players only.
      weekly: rosterId != null ? g.weekly : null,
    });
  }

  // Keep every rostered player, but cap free agents to the ones that matter.
  // The cap is comfortably deeper than fringe-bench depth at every position,
  // so it cannot move the replacement baseline.
  const rostered = candidates.filter((c) => c.rosterId != null);
  const freeAgents = candidates
    .filter((c) => c.rosterId == null)
    .sort(
      (a, b) => (b.overridePoints ?? b.basePoints) - (a.overridePoints ?? a.basePoints)
    )
    .slice(0, FREE_AGENT_LIMIT);

  // Realistic bench composition: how many players each position absorbs
  // league-wide. Prefer this league's actual rosters; fall back to ADP
  // when rosters are sparse (pre-draft), then to the structural bench sim.
  const totalPicks =
    league.settings.numTeams * league.settings.rosterPositions.length;
  const rosterCounts =
    positionCountsFromRosters(rostered, totalPicks) ??
    positionCountsFromAdp(
      candidates.map((c) => ({ position: c.position, adp: c.adp })),
      totalPicks
    );

  const valuation = computeValuation([...rostered, ...freeAgents], {
    rosterPositions: league.settings.rosterPositions,
    numTeams: league.settings.numTeams,
    maxKeepers: league.settings.maxKeepers,
    history,
    rosterCounts,
  });

  const seasonRows = await db
    .selectDistinct({ season: thrawnSeasonTeams.season })
    .from(thrawnSeasonTeams)
    .where(eq(thrawnSeasonTeams.leagueId, leagueId));
  const rosterHistorySeasons = seasonRows
    .map((r) => r.season)
    .sort((a, b) => b.localeCompare(a));

  return {
    league: {
      id: league.id,
      sleeperLeagueId: league.sleeperLeagueId,
      name: league.name,
      season: league.season,
      settings: league.settings,
      myRosterId: league.myRosterId,
      projectionSource: league.projectionSource,
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
    rosterHistorySeasons,
    availableSources: PROJECTION_SOURCES.filter((s) =>
      availableSources.has(s)
    ),
  };
}

export type SeasonBoardPlayer = {
  playerId: string;
  name: string;
  position: string | null;
  /** Games played that season; 0 = didn't play. */
  gp: number;
  /** League-scored season-total points. */
  points: number;
  ppg: number;
  /** Per-game PAR vs. that season's fringe-bench replacement. */
  par: number;
  /** Per-game PAR vs. that season's league-average starter. */
  parStarter: number;
};

export type SeasonBoard = {
  season: string;
  teams: {
    rosterId: number;
    ownerId: string | null;
    displayName: string | null;
    teamName: string | null;
    avatar: string | null;
    /** Roster id of the same owner in the current league; null if gone. */
    currentRosterId: number | null;
    players: SeasonBoardPlayer[];
  }[];
  replacement: ReplacementLevel[];
};

/**
 * A past season as it actually happened: the real end-of-season rosters,
 * each player priced by that season's actual stats under this league's
 * scoring, with replacement levels from the same fringe-bench simulation.
 */
export async function getLeagueSeasonBoard(
  userId: string,
  leagueId: string,
  season: string
): Promise<SeasonBoard> {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);

  const seasonTeams = await db
    .select()
    .from(thrawnSeasonTeams)
    .where(
      and(
        eq(thrawnSeasonTeams.leagueId, leagueId),
        eq(thrawnSeasonTeams.season, season)
      )
    )
    .orderBy(thrawnSeasonTeams.rosterId);
  if (seasonTeams.length === 0) {
    return { season, teams: [], replacement: [] };
  }

  const [currentTeams, statRows] = await Promise.all([
    db.select().from(thrawnTeams).where(eq(thrawnTeams.leagueId, leagueId)),
    db
      .select({
        playerId: thrawnPlayerStats.playerId,
        stats: thrawnPlayerStats.stats,
        gp: thrawnPlayerStats.gp,
        firstName: thrawnPlayers.firstName,
        lastName: thrawnPlayers.lastName,
        position: thrawnPlayers.position,
      })
      .from(thrawnPlayerStats)
      .innerJoin(thrawnPlayers, eq(thrawnPlayerStats.playerId, thrawnPlayers.id))
      .where(eq(thrawnPlayerStats.season, season)),
  ]);

  const scoring = league.settings.scoring;
  const lines = statRows
    .filter((r) => r.position && r.gp > 0)
    .map((r) => {
      const points = scoreProjection(r.stats, scoring);
      return {
        playerId: r.playerId,
        name: `${r.firstName} ${r.lastName}`.trim(),
        position: r.position!,
        points,
        gp: r.gp,
        ppg: points / r.gp,
      };
    });
  const lineById = new Map(lines.map((l) => [l.playerId, l]));

  // Names/positions for rostered players who didn't play that season.
  const allRosterIds = [...new Set(seasonTeams.flatMap((t) => t.players))];
  const unplayedIds = allRosterIds.filter((id) => !lineById.has(id));
  const dictRows = unplayedIds.length
    ? await db
        .select({
          id: thrawnPlayers.id,
          firstName: thrawnPlayers.firstName,
          lastName: thrawnPlayers.lastName,
          position: thrawnPlayers.position,
        })
        .from(thrawnPlayers)
        .where(inArray(thrawnPlayers.id, unplayedIds))
    : [];
  const dictById = new Map(dictRows.map((r) => [r.id, r]));

  // Composition anchor from that season's ACTUAL rosters: replacement sits
  // just past what the league genuinely carried at each position.
  const rosterCounts = positionCountsFromRosters(
    allRosterIds.map((id) => ({
      position:
        lineById.get(id)?.position ?? dictById.get(id)?.position ?? "",
    })),
    league.settings.numTeams * league.settings.rosterPositions.length
  );

  const replacement = replacementLevels(
    lines,
    league.settings.rosterPositions,
    league.settings.numTeams,
    rosterCounts
  );

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const teamByOwner = new Map(
    currentTeams.filter((t) => t.ownerId).map((t) => [t.ownerId!, t])
  );

  const teams = seasonTeams.map((t) => {
    const players: SeasonBoardPlayer[] = t.players.map((pid) => {
      const line = lineById.get(pid);
      if (line) {
        const repl = replacement.get(line.position);
        return {
          playerId: pid,
          name: line.name,
          position: line.position,
          gp: line.gp,
          points: round2(line.points),
          ppg: round2(line.ppg),
          par: round2(line.ppg - (repl?.ppg ?? 0)),
          parStarter: round2(line.ppg - (repl?.avgStarterPpg ?? 0)),
        };
      }
      const dict = dictById.get(pid);
      return {
        playerId: pid,
        name: dict ? `${dict.firstName} ${dict.lastName}`.trim() : pid,
        position: dict?.position ?? null,
        gp: 0,
        points: 0,
        ppg: 0,
        par: 0,
        parStarter: 0,
      };
    });
    players.sort((a, b) =>
      a.gp > 0 && b.gp > 0 ? b.par - a.par : b.gp - a.gp
    );
    return {
      rosterId: t.rosterId,
      ownerId: t.ownerId,
      displayName: t.displayName,
      teamName: t.teamName,
      avatar: t.avatar,
      currentRosterId: t.ownerId
        ? teamByOwner.get(t.ownerId)?.rosterId ?? null
        : null,
      players,
    };
  });

  return {
    season,
    teams,
    replacement: [...replacement.values()].sort((a, b) =>
      a.position.localeCompare(b.position)
    ),
  };
}

export type LeagueAnalysis = {
  seasons: {
    season: string;
    teams: (TeamSeasonLuck & {
      /** Roster id in the CURRENT league for the same owner; null if gone. */
      currentRosterId: number | null;
      displayName: string | null;
      teamName: string | null;
    })[];
  }[];
};

/**
 * Historical luck analysis: per past season, each team's actual record vs.
 * its all-play expected record, mapped to current teams by owner id.
 */
export async function getLeagueAnalysis(
  userId: string,
  leagueId: string
): Promise<LeagueAnalysis> {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);

  const [teams, matchupRows] = await Promise.all([
    db
      .select()
      .from(thrawnTeams)
      .where(eq(thrawnTeams.leagueId, leagueId)),
    db
      .select()
      .from(thrawnMatchups)
      .where(eq(thrawnMatchups.leagueId, leagueId)),
  ]);
  const teamByOwner = new Map(
    teams.filter((t) => t.ownerId).map((t) => [t.ownerId!, t])
  );

  const bySeason = new Map<string, typeof matchupRows>();
  for (const row of matchupRows) {
    const list = bySeason.get(row.season) ?? [];
    list.push(row);
    bySeason.set(row.season, list);
  }

  const seasons = [...bySeason.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([season, rows]) => ({
      season,
      teams: computeSeasonLuck(
        rows.map((r) => ({
          week: r.week,
          rosterId: r.rosterId,
          ownerId: r.ownerId,
          matchupId: r.matchupId,
          points: r.points,
        }))
      ).map((t) => {
        const current = t.ownerId ? teamByOwner.get(t.ownerId) : undefined;
        return {
          ...t,
          currentRosterId: current?.rosterId ?? null,
          displayName: current?.displayName ?? null,
          teamName: current?.teamName ?? null,
        };
      }),
    }));

  return { seasons };
}

export type RegressionReport = {
  /** The past season the analysis is computed on. */
  season: string;
  /** Seasons available for this report (past seasons with stats). */
  availableSeasons: string[];
  rows: RegressionRow[];
};

/**
 * Regression/progression targets: players whose last-season TD, yardage, or
 * reception production deviated from what their volume (overall + red-zone
 * opportunities) predicts, priced in this league's scoring.
 */
export async function getLeagueRegression(
  userId: string,
  leagueId: string,
  season?: string
): Promise<RegressionReport> {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);

  const available = pastSeasons(league.season);
  const target = season ?? available[0];
  if (!target || !available.includes(target)) {
    throw new ThrawnError("bad_season", "Season out of range", 400);
  }

  const statRows = await db
    .select({
      playerId: thrawnPlayerStats.playerId,
      stats: thrawnPlayerStats.stats,
      gp: thrawnPlayerStats.gp,
      firstName: thrawnPlayers.firstName,
      lastName: thrawnPlayers.lastName,
      position: thrawnPlayers.position,
    })
    .from(thrawnPlayerStats)
    .innerJoin(thrawnPlayers, eq(thrawnPlayerStats.playerId, thrawnPlayers.id))
    .where(eq(thrawnPlayerStats.season, target));

  const rows = computeRegression(
    statRows
      .filter((r) => r.position && r.gp > 0)
      .map((r) => ({
        playerId: r.playerId,
        name: `${r.firstName} ${r.lastName}`.trim(),
        position: r.position!,
        gp: r.gp,
        stats: r.stats,
      })),
    league.settings.scoring
  );

  return { season: target, availableSeasons: available, rows };
}

/** Raw volume/production keys surfaced in the player detail popout. */
const DETAIL_STAT_KEYS = [
  "pass_att",
  "pass_cmp",
  "pass_yd",
  "pass_td",
  "pass_int",
  "pass_rz_att",
  "rush_att",
  "rush_yd",
  "rush_td",
  "rush_rz_att",
  "rec_tgt",
  "rec",
  "rec_yd",
  "rec_td",
  "rec_rz_tgt",
] as const;

export type PlayerSeasonDetail = {
  season: string;
  gp: number;
  /** Actual raw stats that season, limited to DETAIL_STAT_KEYS. */
  stats: Record<string, number>;
  /** Volume-vs-production luck for that season; null below volume minimums. */
  luck: RegressionRow | null;
};

export type PlayerDetailReport = {
  playerId: string;
  /** Past seasons with any recorded stats, newest first. */
  seasons: PlayerSeasonDetail[];
  /**
   * Current-season projected raw stats: per-key mean across the sources
   * that report the key (volume keys only exist in the Sleeper feed).
   */
  projectedStats: Record<string, number>;
};

/**
 * Everything the player popout needs beyond the valuation payload:
 * per-season raw stats with the season's luck analysis, plus projected
 * volume for the current season.
 */
export async function getLeaguePlayerDetail(
  userId: string,
  leagueId: string,
  playerId: string
): Promise<PlayerDetailReport> {
  const league = await getLeague(userId, leagueId);
  if (!league) throw new ThrawnError("not_found", "League not found", 404);

  const seasons = pastSeasons(league.season);
  const [statRows, projRows] = await Promise.all([
    db
      .select({
        season: thrawnPlayerStats.season,
        playerId: thrawnPlayerStats.playerId,
        stats: thrawnPlayerStats.stats,
        gp: thrawnPlayerStats.gp,
        firstName: thrawnPlayers.firstName,
        lastName: thrawnPlayers.lastName,
        position: thrawnPlayers.position,
      })
      .from(thrawnPlayerStats)
      .innerJoin(
        thrawnPlayers,
        eq(thrawnPlayerStats.playerId, thrawnPlayers.id)
      )
      .where(inArray(thrawnPlayerStats.season, seasons)),
    db
      .select({ stats: thrawnProjections.stats })
      .from(thrawnProjections)
      .where(
        and(
          eq(thrawnProjections.season, league.season),
          eq(thrawnProjections.playerId, playerId)
        )
      ),
  ]);

  const scoring = league.settings.scoring;
  const seasonDetails: PlayerSeasonDetail[] = [];
  for (const season of seasons) {
    const rows = statRows.filter(
      (r) => r.season === season && r.position && r.gp > 0
    );
    const mine = rows.find((r) => r.playerId === playerId);
    if (!mine) continue;
    // The luck fit needs the whole season's population for cohort rates.
    const regRows = computeRegression(
      rows.map((r) => ({
        playerId: r.playerId,
        name: `${r.firstName} ${r.lastName}`.trim(),
        position: r.position!,
        gp: r.gp,
        stats: r.stats,
      })),
      scoring
    );
    const stats: Record<string, number> = {};
    for (const key of DETAIL_STAT_KEYS) {
      const value = (mine.stats as Record<string, number>)[key];
      if (value != null && value !== 0) stats[key] = value;
    }
    seasonDetails.push({
      season,
      gp: mine.gp,
      stats,
      luck: regRows.find((r) => r.playerId === playerId) ?? null,
    });
  }

  const projectedStats: Record<string, number> = {};
  const keyCounts: Record<string, number> = {};
  for (const row of projRows) {
    for (const key of DETAIL_STAT_KEYS) {
      const value = (row.stats as Record<string, number>)[key];
      if (value != null && value !== 0) {
        projectedStats[key] = (projectedStats[key] ?? 0) + value;
        keyCounts[key] = (keyCounts[key] ?? 0) + 1;
      }
    }
  }
  for (const key of Object.keys(projectedStats)) {
    projectedStats[key] =
      Math.round((projectedStats[key]! / keyCounts[key]!) * 10) / 10;
  }

  return { playerId, seasons: seasonDetails, projectedStats };
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
