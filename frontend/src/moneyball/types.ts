import type { Scorecard, Scores, StatKey, Weights } from "./stats";

/** One row of GET /moneyball/board. */
export type BoardPlayer = {
  id: string;
  slug: string;
  name: string;
  photoUrl: string | null;
  team: string | null;
  number: number | null;
  raterCount: number;
  stats: Record<StatKey, number | null>;
  statCounts: Record<StatKey, number>;
  scores: Scorecard;
  myRating: Scores | null;
  myScores: Scorecard | null;
};

export type Board = {
  weights: Weights;
  players: BoardPlayer[];
};

export type RaterBreakdown = {
  userId: string;
  label: string;
  isMe: boolean;
  scores: Scores;
  scorecard: Scorecard;
  updatedAt: string;
};

export type PlayerDetail = BoardPlayer & {
  weights: Weights;
  raters: RaterBreakdown[];
};

export type RoleScores = {
  handler: number | null;
  cutter: number | null;
  defender: number | null;
};

export type LineSlot = {
  playerId: string;
  name: string;
  photoUrl: string | null;
  role: "handler" | "cutter";
  score: number;
  overall: number | null;
};

export type Line = {
  slots: LineSlot[];
  score: number | null;
  short: boolean;
};

export type RankedPlayer = {
  playerId: string;
  name: string;
  photoUrl: string | null;
  scores: Scorecard;
  roles: RoleScores;
  raterCount: number;
};

export type StatLeader = {
  stat: StatKey;
  playerId: string;
  name: string;
  value: number;
};

export type Concentration = {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  range: number;
  p25: number;
  p75: number;
  stdDev: number;
  topMean: number;
  restMean: number | null;
  topGap: number | null;
  gini: number;
};

export type TeamSummary = {
  team: string;
  playerCount: number;
  ratedCount: number;
  concentration: Concentration | null;
  stats: Record<StatKey, number | null>;
  scores: Scorecard;
  players: RankedPlayer[];
  bestPlayers: RankedPlayer[];
  offenseLine: Line;
  defenseLine: Line;
  leaders: StatLeader[];
};

export type TeamsResponse = {
  weights: Weights;
  teams: TeamSummary[];
};
