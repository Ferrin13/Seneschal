/** Types mirroring the Thrawn backend API payloads. */

/** Projection feeds the backend syncs, plus "average" (mean of all). */
export type ProjectionSource = "sleeper" | "espn" | "sharks" | "average";

export type ThrawnLeagueSettings = {
  scoring: Record<string, number>;
  rosterPositions: string[];
  numTeams: number;
  maxKeepers: number;
};

export type ThrawnLeague = {
  id: string;
  sleeperLeagueId: string;
  name: string;
  season: string;
  settings: ThrawnLeagueSettings;
  myRosterId: number | null;
  /** Which projection feed prices players: a single source or the mean. */
  projectionSource: ProjectionSource;
  lastSyncedAt: string | null;
  createdAt: string;
};

export type ThrawnTeam = {
  rosterId: number;
  ownerId: string | null;
  displayName: string | null;
  teamName: string | null;
  avatar: string | null;
  players: string[];
  keepers: string[];
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
  points: number;
  gamesProj: number;
  /** Effective projected points per game. */
  ppg: number;
  overridden: boolean;
  overrideNote: string | null;
  adp: number | null;
  rosterId: number | null;
  positionRank: number;
  /** Points per game of the fringe bench-level player at this position. */
  replacementPpg: number;
  /** Per-game points above replacement (fringe bench baseline). */
  par: number;
  /** Per-game value above the league-average (median) starter. */
  parStarter: number;
  /** Per-game PAR for past seasons, newest first. */
  history: PlayerSeasonPar[];
  /** Population variance of the historical per-game PARs (>=2 seasons). */
  parVariance: number | null;
  /** 1-based rank by PAS among rostered players; null for free agents. */
  keeperRank: number | null;
  keeperLevel: boolean;
  /** League-scored season totals per projection source. */
  sourcePoints: Record<string, number>;
  /** NFL bye week for the player's team this season; null when unknown. */
  byeWeek: number | null;
  /**
   * Week-by-week projected points in the source's own scoring (index =
   * week - 1, zeros on byes). Rostered players only; used as a shape and
   * scaled to the league-scored season total.
   */
  weekly: number[] | null;
};

export type ReplacementLevel = {
  position: string;
  /** Points per game of the replacement (first player beyond all rosters). */
  ppg: number;
  /** 1-based position rank the replacement sits at. */
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
  keeperSlots: number;
  /** Per-game PAS of the last player inside the keeper slots. */
  keeperLinePas: number | null;
  /** Minimum per-game PAR required to be keeper-eligible. */
  keeperMinPar: number;
};

export type LeagueValues = {
  league: ThrawnLeague;
  teams: ThrawnTeam[];
  valuation: ValuationResult;
  /** Past seasons with real roster snapshots available, newest first. */
  rosterHistorySeasons: string[];
  /** Projection sources with data for this season. */
  availableSources: string[];
};

export type SeasonBoardPlayer = {
  playerId: string;
  name: string;
  position: string | null;
  /** Games played that season; 0 = didn't play. */
  gp: number;
  points: number;
  ppg: number;
  /** Per-game PAR vs. that season's fringe-bench replacement. */
  par: number;
  /** Per-game PAS vs. that season's league-average starter. */
  parStarter: number;
};

export type SeasonBoardTeam = {
  rosterId: number;
  ownerId: string | null;
  displayName: string | null;
  teamName: string | null;
  avatar: string | null;
  /** Roster id of the same owner in the current league; null if gone. */
  currentRosterId: number | null;
  players: SeasonBoardPlayer[];
};

/** A past season as it happened: real rosters priced at actual stats. */
export type SeasonBoard = {
  season: string;
  teams: SeasonBoardTeam[];
  replacement: ReplacementLevel[];
};

export type TeamSeasonLuck = {
  /** Roster id in THAT season's league (ids shuffle between seasons). */
  rosterId: number;
  ownerId: string | null;
  /** Roster id in the current league for the same owner; null if gone. */
  currentRosterId: number | null;
  displayName: string | null;
  teamName: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** All-play expected wins over the season. */
  expectedWins: number;
  /** Actual wins (ties count half) minus expected wins; positive = lucky. */
  luck: number;
  weeks: number;
};

export type LeagueAnalysis = {
  seasons: { season: string; teams: TeamSeasonLuck[] }[];
};

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

/** Regression/progression targets computed on one past season. */
export type RegressionReport = {
  season: string;
  availableSeasons: string[];
  rows: RegressionRow[];
};

/** One past season in the player detail popout. */
export type PlayerSeasonDetail = {
  season: string;
  gp: number;
  /** Actual raw volume/production stats (pass_att, rec_tgt, rz opps, ...). */
  stats: Record<string, number>;
  /** Volume-vs-production luck that season; null below volume minimums. */
  luck: RegressionRow | null;
};

export type PlayerDetailReport = {
  playerId: string;
  /** Past seasons with recorded stats, newest first. */
  seasons: PlayerSeasonDetail[];
  /** Current-season projected raw stats (per-key mean across sources). */
  projectedStats: Record<string, number>;
};
