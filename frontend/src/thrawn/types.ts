/** Types mirroring the Thrawn backend API payloads. */

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

export type PlayerValue = {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
  age: number | null;
  basePoints: number;
  points: number;
  overridden: boolean;
  overrideNote: string | null;
  adp: number | null;
  rosterId: number | null;
  positionRank: number;
  replacementPoints: number;
  var: number;
  keeperRank: number | null;
  keeperLevel: boolean;
};

export type ReplacementLevel = {
  position: string;
  starterSlots: number;
  points: number;
  playerId: string | null;
  playerName: string | null;
};

export type ValuationResult = {
  values: PlayerValue[];
  replacement: ReplacementLevel[];
  keeperSlots: number;
  keeperLineVar: number | null;
};

export type LeagueValues = {
  league: ThrawnLeague;
  teams: ThrawnTeam[];
  valuation: ValuationResult;
};
