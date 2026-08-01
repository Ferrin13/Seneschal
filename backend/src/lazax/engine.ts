import { FACTION_BY_ID } from "./factions.js";

export type Phase = "strategy" | "action" | "status" | "agenda";
export type ActionState = "ready" | "exhausted" | "passed";
export type ClockState = "running" | "paused";

export type EnginePlayer = {
  id: string;
  factionId: string;
  seatIndex: number;
  strategyCard: number | null;
  actionState: ActionState;
};

export type EngineGame = {
  phase: Phase;
  roundNumber: number;
  speakerPlayerId: string | null;
  activePlayerId: string | null;
  clockState: ClockState;
  status: "setup" | "active" | "finished";
};

export class EngineError extends Error {
  constructor(
    message: string,
    public code:
      | "invalid_state"
      | "not_paused"
      | "not_running"
      | "missing_cards"
      | "bad_player"
      | "bad_card" = "invalid_state"
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** Effective initiative for action-phase ordering (Naalu = 0). */
export function effectiveInitiative(player: EnginePlayer): number {
  const faction = FACTION_BY_ID[player.factionId];
  if (faction?.initiativeOverride != null) return faction.initiativeOverride;
  if (player.strategyCard == null) return Number.POSITIVE_INFINITY;
  return player.strategyCard;
}

/** Clockwise seat order starting from the speaker (inclusive). */
export function speakerOrder(players: EnginePlayer[], speakerId: string): EnginePlayer[] {
  const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
  const start = sorted.findIndex((p) => p.id === speakerId);
  if (start < 0) throw new EngineError("Speaker not found among players", "bad_player");
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

/**
 * Agenda voting order: clockwise starting to the speaker's left, speaker last.
 * (Speaker reveals; voting begins with the next seat.)
 */
export function agendaOrder(players: EnginePlayer[], speakerId: string): EnginePlayer[] {
  const fromSpeaker = speakerOrder(players, speakerId);
  if (fromSpeaker.length <= 1) return fromSpeaker;
  return [...fromSpeaker.slice(1), fromSpeaker[0]!];
}

export function nextInAgendaOrder(
  players: EnginePlayer[],
  speakerId: string,
  currentId: string | null
): EnginePlayer | null {
  const order = agendaOrder(players, speakerId);
  if (order.length === 0) return null;
  if (currentId == null) return order[0]!;
  const idx = order.findIndex((p) => p.id === currentId);
  if (idx < 0) return order[0]!;
  // No wrap — after the speaker votes, the cycle is done.
  return order[idx + 1] ?? null;
}

/** Action-phase order: ascending initiative, skipping passed players. */
export function actionOrder(players: EnginePlayer[]): EnginePlayer[] {
  return [...players]
    .filter((p) => p.actionState !== "passed")
    .sort((a, b) => {
      const ia = effectiveInitiative(a);
      const ib = effectiveInitiative(b);
      if (ia !== ib) return ia - ib;
      return a.seatIndex - b.seatIndex;
    });
}

export function nextInSpeakerOrder(
  players: EnginePlayer[],
  speakerId: string,
  currentId: string | null
): EnginePlayer | null {
  const order = speakerOrder(players, speakerId);
  if (order.length === 0) return null;
  if (currentId == null) return order[0]!;
  const idx = order.findIndex((p) => p.id === currentId);
  if (idx < 0) return order[0]!;
  const next = order[idx + 1];
  return next ?? null;
}

export function nextInActionOrder(
  players: EnginePlayer[],
  currentId: string | null
): EnginePlayer | null {
  const order = actionOrder(players);
  if (order.length === 0) return null;
  if (currentId == null) return order[0]!;
  const idx = order.findIndex((p) => p.id === currentId);
  if (idx < 0) return order[0]!;
  // Wrap among unpassed players (sole remaining player acts again).
  return order[(idx + 1) % order.length]!;
}

export function allPassed(players: EnginePlayer[]): boolean {
  return players.length > 0 && players.every((p) => p.actionState === "passed");
}

export function allHaveStrategyCards(players: EnginePlayer[]): boolean {
  return players.length > 0 && players.every((p) => p.strategyCard != null);
}

export function assertCanOverrideActive(game: EngineGame): void {
  if (game.clockState !== "paused") {
    throw new EngineError("Active player can only be overridden while paused", "not_paused");
  }
  if (game.status !== "active") {
    throw new EngineError("Game is not active", "invalid_state");
  }
}

export type TurnAdvanceResult = {
  activePlayerId: string | null;
  phase: Phase;
  /** When entering status because everyone passed. */
  allPassed?: boolean;
  /** Players whose actionState should be updated (id → state). */
  playerUpdates?: Array<{ id: string; actionState?: ActionState; strategyCard?: number | null }>;
};

/**
 * After the current player's turn ends in the current phase (without passing),
 * pick the next active player. Does not mutate inputs.
 */
export function advanceAfterEndTurn(
  game: EngineGame,
  players: EnginePlayer[]
): TurnAdvanceResult {
  if (game.status !== "active") {
    throw new EngineError("Game is not active", "invalid_state");
  }
  if (!game.speakerPlayerId) {
    throw new EngineError("Speaker is not set", "invalid_state");
  }

  switch (game.phase) {
    case "strategy": {
      const next = nextInSpeakerOrder(players, game.speakerPlayerId, game.activePlayerId);
      if (next == null) {
        // Full cycle complete — stay on last / null until admin advances phase.
        return { activePlayerId: null, phase: "strategy" };
      }
      // If we've wrapped past everyone who still needs a card, prefer first without card.
      const needing = speakerOrder(players, game.speakerPlayerId).filter(
        (p) => p.strategyCard == null
      );
      if (needing.length === 0) {
        return { activePlayerId: null, phase: "strategy" };
      }
      // If next already has a card, jump to next needing card in speaker order.
      const from = game.activePlayerId;
      const order = speakerOrder(players, game.speakerPlayerId);
      const startIdx = from ? order.findIndex((p) => p.id === from) : -1;
      for (let i = 1; i <= order.length; i++) {
        const cand = order[(startIdx + i + order.length) % order.length]!;
        if (cand.strategyCard == null) {
          return { activePlayerId: cand.id, phase: "strategy" };
        }
      }
      return { activePlayerId: null, phase: "strategy" };
    }
    case "action": {
      const next = nextInActionOrder(players, game.activePlayerId);
      if (next == null || allPassed(players)) {
        return { activePlayerId: null, phase: "status", allPassed: true };
      }
      // If next is the same player and they just ended (didn't pass), they go again —
      // that's correct when only one remains. If somehow all others passed, ok.
      return { activePlayerId: next.id, phase: "action" };
    }
    case "agenda": {
      // From general time (null active) → first voter left of speaker; then clockwise;
      // after speaker, back to null (general / ready to finish round).
      const next = nextInAgendaOrder(
        players,
        game.speakerPlayerId,
        game.activePlayerId
      );
      return { activePlayerId: next?.id ?? null, phase: "agenda" };
    }
    case "status":
      throw new EngineError("No player turns in status phase", "invalid_state");
    default:
      throw new EngineError("Unknown phase", "invalid_state");
  }
}

export function advanceAfterPass(
  game: EngineGame,
  players: EnginePlayer[],
  playerId: string
): TurnAdvanceResult {
  if (game.phase !== "action") {
    throw new EngineError("Pass is only valid in the action phase", "invalid_state");
  }
  const updated = players.map((p) =>
    p.id === playerId ? { ...p, actionState: "passed" as const } : p
  );
  if (allPassed(updated)) {
    return {
      activePlayerId: null,
      phase: "status",
      allPassed: true,
      playerUpdates: [{ id: playerId, actionState: "passed" }],
    };
  }
  const next = nextInActionOrder(updated, playerId);
  return {
    activePlayerId: next?.id ?? null,
    phase: "action",
    playerUpdates: [{ id: playerId, actionState: "passed" }],
  };
}

export type PhaseAdvanceResult = {
  phase: Phase;
  roundNumber: number;
  activePlayerId: string | null;
  /** Reset strategy cards / action states for a new round. */
  resetPlayers?: boolean;
};

/**
 * Admin advances to the next phase (or next round from agenda/status).
 */
export function advancePhase(
  game: EngineGame,
  players: EnginePlayer[]
): PhaseAdvanceResult {
  if (game.status !== "active") {
    throw new EngineError("Game is not active", "invalid_state");
  }
  if (!game.speakerPlayerId) {
    throw new EngineError("Speaker is not set", "invalid_state");
  }

  switch (game.phase) {
    case "strategy": {
      if (!allHaveStrategyCards(players)) {
        throw new EngineError(
          "All players must have a strategy card before leaving strategy phase",
          "missing_cards"
        );
      }
      const order = actionOrder(
        players.map((p) => ({ ...p, actionState: "ready" as const }))
      );
      return {
        phase: "action",
        roundNumber: game.roundNumber,
        activePlayerId: order[0]?.id ?? null,
      };
    }
    case "action":
      return {
        phase: "status",
        roundNumber: game.roundNumber,
        activePlayerId: null,
      };
    case "status":
      // Agenda opens on general time; voting starts later via end-turn
      // (first voter = left of speaker).
      return {
        phase: "agenda",
        roundNumber: game.roundNumber,
        activePlayerId: null,
      };
    case "agenda": {
      // Next round → strategy phase; clear cards and action states.
      const order = speakerOrder(players, game.speakerPlayerId);
      return {
        phase: "strategy",
        roundNumber: game.roundNumber + 1,
        activePlayerId: order[0]?.id ?? null,
        resetPlayers: true,
      };
    }
    default:
      throw new EngineError("Unknown phase", "invalid_state");
  }
}

export function startGameActivePlayer(
  players: EnginePlayer[],
  speakerId: string
): string {
  const order = speakerOrder(players, speakerId);
  if (order.length === 0) throw new EngineError("No players", "bad_player");
  return order[0]!.id;
}
