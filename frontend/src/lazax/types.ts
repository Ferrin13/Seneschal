export type LazaxPhase = "strategy" | "action" | "status" | "agenda";
export type LazaxClockState = "running" | "paused";
export type LazaxGameStatus = "setup" | "active" | "finished";
export type LazaxActionState = "ready" | "exhausted" | "passed";
export type LazaxSegmentKind = "player" | "general";

export type Faction = {
  id: string;
  name: string;
  abbrev: string;
  color: string;
  initiativeOverride?: number;
};

export type StrategyCard = {
  initiative: number;
  name: string;
};

export type LazaxGame = {
  id: string;
  ownerUserId: string;
  name: string;
  status: LazaxGameStatus;
  phase: LazaxPhase;
  roundNumber: number;
  speakerPlayerId: string | null;
  activePlayerId: string | null;
  clockState: LazaxClockState;
  createdAt: string;
  updatedAt: string;
};

export type LazaxPlayer = {
  id: string;
  gameId: string;
  displayName: string;
  factionId: string;
  seatIndex: number;
  strategyCard: number | null;
  actionState: LazaxActionState;
};

export type LazaxSegment = {
  id: string;
  gameId: string;
  playerId: string | null;
  kind: LazaxSegmentKind;
  phase: LazaxPhase;
  roundNumber: number;
  startedAt: string;
  endedAt: string | null;
};

export type GameSnapshot = {
  game: LazaxGame;
  players: LazaxPlayer[];
  openSegment: LazaxSegment | null;
  serverNow: string;
  totals: {
    byPlayer: Record<string, number>;
    byRound: Record<number, number>;
    byPlayerRound: Record<string, Record<number, number>>;
    generalMs: number;
    totalMs: number;
  };
};

export type LazaxStats = {
  game: LazaxGame;
  players: LazaxPlayer[];
  byPlayer: Record<string, number>;
  byPhase: Record<string, number>;
  byRound: Record<number, number>;
  byPlayerPhase: Array<{
    playerId: string | null;
    phase: LazaxPhase;
    durationMs: number;
  }>;
  byPlayerRound: Array<{
    playerId: string | null;
    roundNumber: number;
    durationMs: number;
  }>;
  generalMs: number;
  totalMs: number;
  segments: Array<{
    segmentId: string;
    gameId: string;
    playerId: string | null;
    kind: LazaxSegmentKind;
    phase: LazaxPhase;
    roundNumber: number;
    startedAt: string;
    endedAt: string | null;
    durationMs: number;
  }>;
  serverNow: string;
};

export type CreatePlayerInput = {
  displayName: string;
  factionId: string;
  seatIndex: number;
};
