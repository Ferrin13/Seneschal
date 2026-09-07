import type { RoleScores, RoleWeights, Scorecard, Scores, StatKey, Weights } from "./stats";

export type { RoleScores } from "./stats";

export type Gender = "M" | "F";

/** One row of GET /moneyball/board. */
export type BoardPlayer = {
  id: string;
  slug: string;
  name: string;
  photoUrl: string | null;
  team: string | null;
  /** null = unknown; such players can't be placed on a line. */
  gender: Gender | null;
  number: number | null;
  raterCount: number;
  stats: Record<StatKey, number | null>;
  statCounts: Record<StatKey, number>;
  scores: Scorecard;
  /** Handler/cutter/defender OVRs over the team means. */
  roles: RoleScores;
  myRating: Scores | null;
  myScores: Scorecard | null;
};

export type Board = {
  weights: Weights;
  roleWeights: RoleWeights;
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
  roleWeights: RoleWeights;
  raters: RaterBreakdown[];
};

export type RankedPlayer = {
  playerId: string;
  name: string;
  photoUrl: string | null;
  gender: Gender | null;
  scores: Scorecard;
  roles: RoleScores;
  raterCount: number;
};

/** Rostered player nobody has rated yet. */
export type UnratedPlayer = {
  playerId: string;
  name: string;
  photoUrl: string | null;
  gender: Gender | null;
};

export type StatLeader = {
  stat: StatKey;
  value: number;
  /** Everyone tied at the top value, alphabetical. */
  players: { playerId: string; name: string }[];
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
  /** Every rated player, best OVR first. */
  players: RankedPlayer[];
  /** Rostered players with no ratings, alphabetical. */
  unrated: UnratedPlayer[];
  leaders: StatLeader[];
};

export type TeamsResponse = {
  weights: Weights;
  teams: TeamSummary[];
};

/** Raw player row as seen by the Roster admin page. */
export type AdminPlayer = {
  id: string;
  slug: string;
  name: string;
  /** Stored value: site path, http(s) URL, or `s3:<key>` for uploads. */
  photoUrl: string | null;
  /** Loadable URL for previews (presigned when stored in S3). */
  photoSrc: string | null;
  team: string | null;
  gender: Gender | null;
  number: number | null;
  active: boolean;
  /** True once edited here; the boot-time roster.ts sync then skips the row. */
  manuallyEdited: boolean;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminPlayerInput = {
  slug: string;
  name: string;
  photoUrl: string | null;
  team: string | null;
  gender: Gender | null;
  number: number | null;
  active: boolean;
};
