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
