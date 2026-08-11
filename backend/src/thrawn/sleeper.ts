/**
 * Read-only client for Sleeper's public API. No auth required.
 *
 * Two hosts are involved: the documented v1 API on api.sleeper.app (league,
 * rosters, users, players dump) and the undocumented projections feed on
 * api.sleeper.com (rotowire season projections, the same feed the Sleeper
 * app itself uses).
 */

const V1_BASE = "https://api.sleeper.app/v1";
const PROJECTIONS_BASE = "https://api.sleeper.com";

/** Fantasy positions Thrawn cares about (matches standard lineups). */
export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type FantasyPosition = (typeof FANTASY_POSITIONS)[number];

export class SleeperError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new SleeperError(res.status, `Sleeper request failed (${res.status}): ${url}`);
  }
  return (await res.json()) as T;
}

export type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  settings: {
    num_teams: number;
    max_keepers: number;
    [key: string]: number;
  };
  previous_league_id: string | null;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  keepers: string[] | null;
};

export type SleeperLeagueUser = {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata: { team_name?: string } | null;
};

export type SleeperPlayerDumpEntry = {
  player_id: string;
  first_name: string;
  last_name: string;
  position: string | null;
  fantasy_positions: string[] | null;
  team: string | null;
  age: number | null;
  status: string | null;
  injury_status: string | null;
  years_exp: number | null;
};

export type SleeperProjectionEntry = {
  player_id: string;
  season: string;
  week: number | null;
  stats: Record<string, number> | null;
  player: {
    first_name: string;
    last_name: string;
    position: string | null;
    fantasy_positions: string[] | null;
    team: string | null;
    injury_status: string | null;
  } | null;
};

export type SleeperMatchup = {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
};

export function fetchLeague(leagueId: string): Promise<SleeperLeague> {
  return getJson(`${V1_BASE}/league/${leagueId}`);
}

/** All teams' scores for one week (paired head-to-head by matchup_id). */
export function fetchMatchups(
  leagueId: string,
  week: number
): Promise<SleeperMatchup[]> {
  return getJson(`${V1_BASE}/league/${leagueId}/matchups/${week}`);
}

export function fetchRosters(leagueId: string): Promise<SleeperRoster[]> {
  return getJson(`${V1_BASE}/league/${leagueId}/rosters`);
}

export function fetchLeagueUsers(leagueId: string): Promise<SleeperLeagueUser[]> {
  return getJson(`${V1_BASE}/league/${leagueId}/users`);
}

/**
 * The full NFL player dictionary (~5MB). Sleeper asks that this be called at
 * most once per day; the service layer caches it in thrawn_players.
 */
export function fetchPlayersDump(): Promise<Record<string, SleeperPlayerDumpEntry>> {
  return getJson(`${V1_BASE}/players/nfl`);
}

/** Season-long projections for all fantasy-relevant positions. */
export function fetchSeasonProjections(
  season: string
): Promise<SleeperProjectionEntry[]> {
  const positions = FANTASY_POSITIONS.map((p) => `position[]=${p}`).join("&");
  return getJson(
    `${PROJECTIONS_BASE}/projections/nfl/${season}?season_type=regular&${positions}&order_by=ppr`
  );
}

/**
 * Actual season-total stats (same record shape as the projections feed,
 * with `stats.gp` = real games played). Used for historical PAR.
 */
export function fetchSeasonStats(
  season: string
): Promise<SleeperProjectionEntry[]> {
  const positions = FANTASY_POSITIONS.map((p) => `position[]=${p}`).join("&");
  return getJson(
    `${PROJECTIONS_BASE}/stats/nfl/${season}?season_type=regular&${positions}&order_by=pts_ppr`
  );
}
