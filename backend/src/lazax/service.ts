import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  lazaxGames,
  lazaxPlayers,
  lazaxTimeSegments,
  type LazaxGame,
  type LazaxPlayer,
  type LazaxTimeSegment,
} from "../db/schema.js";
import {
  advanceAfterEndTurn,
  advanceAfterPass,
  advancePhase,
  assertCanOverrideActive,
  EngineError,
  startGameActivePlayer,
  type ActionState,
  type EnginePlayer,
  type Phase,
} from "./engine.js";
import { isValidFactionId } from "./factions.js";
import {
  aggregateStats,
  describeOpenGeneralSegment,
  describeOpenPlayerSegment,
} from "./segments.js";
import { broadcastGame } from "./hub.js";

function toEnginePlayer(p: LazaxPlayer): EnginePlayer {
  return {
    id: p.id,
    factionId: p.factionId,
    seatIndex: p.seatIndex,
    strategyCard: p.strategyCard,
    actionState: p.actionState,
  };
}

async function closeOpenSegments(gameId: string, at: Date) {
  await db
    .update(lazaxTimeSegments)
    .set({ endedAt: at })
    .where(and(eq(lazaxTimeSegments.gameId, gameId), isNull(lazaxTimeSegments.endedAt)));
}

async function openSegment(input: {
  gameId: string;
  playerId: string | null;
  kind: "player" | "general";
  phase: Phase;
  roundNumber: number;
  at: Date;
}) {
  const [row] = await db
    .insert(lazaxTimeSegments)
    .values({
      gameId: input.gameId,
      playerId: input.playerId,
      kind: input.kind,
      phase: input.phase,
      roundNumber: input.roundNumber,
      startedAt: input.at,
    })
    .returning();
  return row!;
}

async function loadPlayers(gameId: string): Promise<LazaxPlayer[]> {
  return db
    .select()
    .from(lazaxPlayers)
    .where(eq(lazaxPlayers.gameId, gameId))
    .orderBy(asc(lazaxPlayers.seatIndex));
}

async function loadOpenSegment(gameId: string): Promise<LazaxTimeSegment | null> {
  const rows = await db
    .select()
    .from(lazaxTimeSegments)
    .where(and(eq(lazaxTimeSegments.gameId, gameId), isNull(lazaxTimeSegments.endedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export function serializeSegment(s: LazaxTimeSegment) {
  return {
    id: s.id,
    gameId: s.gameId,
    playerId: s.playerId,
    kind: s.kind,
    phase: s.phase,
    roundNumber: s.roundNumber,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
  };
}

export function serializePlayer(p: LazaxPlayer) {
  return {
    id: p.id,
    gameId: p.gameId,
    displayName: p.displayName,
    factionId: p.factionId,
    seatIndex: p.seatIndex,
    strategyCard: p.strategyCard,
    actionState: p.actionState,
  };
}

export function serializeGame(g: LazaxGame) {
  return {
    id: g.id,
    ownerUserId: g.ownerUserId,
    name: g.name,
    status: g.status,
    phase: g.phase,
    roundNumber: g.roundNumber,
    speakerPlayerId: g.speakerPlayerId,
    activePlayerId: g.activePlayerId,
    clockState: g.clockState,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

export type GameSnapshot = {
  game: ReturnType<typeof serializeGame>;
  players: ReturnType<typeof serializePlayer>[];
  openSegment: ReturnType<typeof serializeSegment> | null;
  serverNow: string;
  totals: {
    byPlayer: Record<string, number>;
    byRound: Record<number, number>;
    /** playerId -> roundNumber -> ms (player segments only). */
    byPlayerRound: Record<string, Record<number, number>>;
    generalMs: number;
    totalMs: number;
  };
};

function byPlayerRoundMap(
  rows: Array<{ playerId: string | null; roundNumber: number; durationMs: number }>
): Record<string, Record<number, number>> {
  const out: Record<string, Record<number, number>> = {};
  for (const row of rows) {
    if (!row.playerId) continue;
    const perRound = (out[row.playerId] ??= {});
    perRound[row.roundNumber] = (perRound[row.roundNumber] ?? 0) + row.durationMs;
  }
  return out;
}

export async function getSnapshot(gameId: string): Promise<GameSnapshot | null> {
  const [game] = await db
    .select()
    .from(lazaxGames)
    .where(eq(lazaxGames.id, gameId))
    .limit(1);
  if (!game) return null;
  const players = await loadPlayers(gameId);
  const open = await loadOpenSegment(gameId);
  const segments = await db
    .select()
    .from(lazaxTimeSegments)
    .where(eq(lazaxTimeSegments.gameId, gameId));
  const now = new Date();
  const stats = aggregateStats(segments, now);
  return {
    game: serializeGame(game),
    players: players.map(serializePlayer),
    openSegment: open ? serializeSegment(open) : null,
    serverNow: now.toISOString(),
    totals: {
      byPlayer: stats.byPlayer,
      byRound: stats.byRound,
      byPlayerRound: byPlayerRoundMap(stats.byPlayerRound),
      generalMs: stats.generalMs,
      totalMs: stats.totalMs,
    },
  };
}

async function touchAndBroadcast(gameId: string): Promise<GameSnapshot> {
  const snap = await getSnapshot(gameId);
  if (!snap) throw new EngineError("Game not found", "invalid_state");
  broadcastGame(gameId, snap);
  return snap;
}

export async function listGames(ownerUserId: string) {
  const rows = await db
    .select()
    .from(lazaxGames)
    .where(eq(lazaxGames.ownerUserId, ownerUserId))
    .orderBy(desc(lazaxGames.updatedAt));
  return rows.map(serializeGame);
}

export type CreatePlayerInput = {
  displayName: string;
  factionId: string;
  seatIndex: number;
};

export async function createGame(
  ownerUserId: string,
  name: string,
  players: CreatePlayerInput[],
  speakerSeatIndex: number
) {
  if (players.length < 3 || players.length > 8) {
    throw new EngineError("Games require 3–8 players", "invalid_state");
  }
  const seats = new Set(players.map((p) => p.seatIndex));
  const factions = new Set(players.map((p) => p.factionId));
  if (seats.size !== players.length) {
    throw new EngineError("Seat indices must be unique", "invalid_state");
  }
  if (factions.size !== players.length) {
    throw new EngineError("Factions must be unique", "invalid_state");
  }
  for (const p of players) {
    if (!isValidFactionId(p.factionId)) {
      throw new EngineError(`Unknown faction: ${p.factionId}`, "bad_player");
    }
  }
  if (!players.some((p) => p.seatIndex === speakerSeatIndex)) {
    throw new EngineError("Speaker seat must match a player", "bad_player");
  }

  const gameId = await db.transaction(async (tx) => {
    const [game] = await tx
      .insert(lazaxGames)
      .values({
        ownerUserId,
        name: name || "Twilight Imperium",
        status: "setup",
        phase: "strategy",
        roundNumber: 1,
        clockState: "paused",
      })
      .returning();

    const inserted = await tx
      .insert(lazaxPlayers)
      .values(
        players.map((p) => ({
          gameId: game!.id,
          displayName: p.displayName.trim(),
          factionId: p.factionId,
          seatIndex: p.seatIndex,
          actionState: "ready" as const,
        }))
      )
      .returning();

    const speaker = inserted.find((p) => p.seatIndex === speakerSeatIndex)!;
    await tx
      .update(lazaxGames)
      .set({ speakerPlayerId: speaker.id, updatedAt: new Date() })
      .where(eq(lazaxGames.id, game!.id));

    return game!.id;
  });

  return getSnapshot(gameId);
}

async function requireOwnedGame(gameId: string, ownerUserId: string): Promise<LazaxGame> {
  const [game] = await db
    .select()
    .from(lazaxGames)
    .where(eq(lazaxGames.id, gameId))
    .limit(1);
  if (!game) throw new EngineError("Game not found", "invalid_state");
  if (game.ownerUserId !== ownerUserId) {
    throw new EngineError("Only the game owner can do that", "invalid_state");
  }
  return game;
}

export async function startGame(gameId: string, ownerUserId: string) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  if (game.status !== "setup") {
    throw new EngineError("Game already started", "invalid_state");
  }
  const players = await loadPlayers(gameId);
  if (!game.speakerPlayerId) {
    throw new EngineError("Speaker is not set", "invalid_state");
  }
  const activeId = startGameActivePlayer(players.map(toEnginePlayer), game.speakerPlayerId);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(lazaxGames)
      .set({
        status: "active",
        phase: "strategy",
        activePlayerId: activeId,
        clockState: "running",
        updatedAt: now,
      })
      .where(eq(lazaxGames.id, gameId));

    const open = describeOpenPlayerSegment(gameId, activeId, "strategy", 1, now);
    await tx.insert(lazaxTimeSegments).values({
      gameId: open.gameId,
      playerId: open.playerId,
      kind: open.kind,
      phase: open.phase,
      roundNumber: open.roundNumber,
      startedAt: open.at,
    });
  });

  return touchAndBroadcast(gameId);
}

export async function pauseGame(gameId: string, ownerUserId: string) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  if (game.status !== "active") throw new EngineError("Game is not active", "invalid_state");
  if (game.clockState === "paused") return touchAndBroadcast(gameId);

  const now = new Date();
  await closeOpenSegments(gameId, now);
  await openSegment(describeOpenGeneralSegment(gameId, game.phase, game.roundNumber, now));
  await db
    .update(lazaxGames)
    .set({ clockState: "paused", updatedAt: now })
    .where(eq(lazaxGames.id, gameId));

  return touchAndBroadcast(gameId);
}

export async function resumeGame(gameId: string, ownerUserId: string) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  if (game.status !== "active") throw new EngineError("Game is not active", "invalid_state");
  if (game.clockState === "running") return touchAndBroadcast(gameId);

  const now = new Date();
  await closeOpenSegments(gameId, now);

  if (game.activePlayerId && game.phase !== "status") {
    await openSegment(
      describeOpenPlayerSegment(
        gameId,
        game.activePlayerId,
        game.phase,
        game.roundNumber,
        now
      )
    );
  } else {
    await openSegment(
      describeOpenGeneralSegment(gameId, game.phase, game.roundNumber, now)
    );
  }

  await db
    .update(lazaxGames)
    .set({ clockState: "running", updatedAt: now })
    .where(eq(lazaxGames.id, gameId));

  return touchAndBroadcast(gameId);
}

export async function setActivePlayer(
  gameId: string,
  ownerUserId: string,
  playerId: string
) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  assertCanOverrideActive({
    phase: game.phase,
    roundNumber: game.roundNumber,
    speakerPlayerId: game.speakerPlayerId,
    activePlayerId: game.activePlayerId,
    clockState: game.clockState,
    status: game.status,
  });
  const players = await loadPlayers(gameId);
  if (!players.some((p) => p.id === playerId)) {
    throw new EngineError("Player not in game", "bad_player");
  }

  const now = new Date();
  await db
    .update(lazaxGames)
    .set({ activePlayerId: playerId, updatedAt: now })
    .where(eq(lazaxGames.id, gameId));

  return touchAndBroadcast(gameId);
}

export async function setSpeaker(
  gameId: string,
  ownerUserId: string,
  playerId: string
) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  const players = await loadPlayers(gameId);
  if (!players.some((p) => p.id === playerId)) {
    throw new EngineError("Player not in game", "bad_player");
  }
  await db
    .update(lazaxGames)
    .set({ speakerPlayerId: playerId, updatedAt: new Date() })
    .where(eq(lazaxGames.id, gameId));
  return touchAndBroadcast(gameId);
}

export async function assignStrategyCard(
  gameId: string,
  ownerUserId: string,
  playerId: string,
  card: number | null
) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  if (game.phase !== "strategy" || game.status !== "active") {
    throw new EngineError("Strategy cards only during strategy phase", "invalid_state");
  }
  if (card != null && (card < 1 || card > 8)) {
    throw new EngineError("Invalid strategy card", "bad_card");
  }

  const players = await loadPlayers(gameId);
  if (!players.some((p) => p.id === playerId)) {
    throw new EngineError("Player not in game", "bad_player");
  }
  if (
    card != null &&
    players.some((p) => p.strategyCard === card && p.id !== playerId)
  ) {
    throw new EngineError("Strategy card already taken", "bad_card");
  }

  const now = new Date();
  await db
    .update(lazaxPlayers)
    .set({ strategyCard: card, updatedAt: now })
    .where(and(eq(lazaxPlayers.id, playerId), eq(lazaxPlayers.gameId, gameId)));

  // Clearing a pick: put that player back as active so they can choose again.
  if (card == null) {
    if (game.activePlayerId !== playerId) {
      await applyActiveChange(
        game,
        playerId,
        "strategy",
        game.roundNumber,
        now
      );
    }
    return touchAndBroadcast(gameId);
  }

  const updatedPlayers = players.map((p) =>
    p.id === playerId ? { ...p, strategyCard: card } : p
  );
  const result = advanceAfterEndTurn(
    {
      phase: game.phase,
      roundNumber: game.roundNumber,
      speakerPlayerId: game.speakerPlayerId,
      // Advance from the player who just picked.
      activePlayerId: playerId,
      clockState: game.clockState,
      status: game.status,
    },
    updatedPlayers.map(toEnginePlayer)
  );

  if (
    result.activePlayerId !== game.activePlayerId ||
    result.phase !== game.phase
  ) {
    await applyActiveChange(
      game,
      result.activePlayerId,
      result.phase,
      game.roundNumber,
      now
    );
  }

  return touchAndBroadcast(gameId);
}

async function applyActiveChange(
  game: LazaxGame,
  nextActiveId: string | null,
  nextPhase: Phase,
  nextRound: number,
  now: Date
) {
  const wasRunning = game.clockState === "running";
  await closeOpenSegments(game.id, now);

  await db
    .update(lazaxGames)
    .set({
      activePlayerId: nextActiveId,
      phase: nextPhase,
      roundNumber: nextRound,
      updatedAt: now,
    })
    .where(eq(lazaxGames.id, game.id));

  if (!wasRunning) {
    await openSegment(
      describeOpenGeneralSegment(game.id, nextPhase, nextRound, now)
    );
    return;
  }

  if (nextActiveId && nextPhase !== "status") {
    await openSegment(
      describeOpenPlayerSegment(game.id, nextActiveId, nextPhase, nextRound, now)
    );
  } else {
    await openSegment(
      describeOpenGeneralSegment(game.id, nextPhase, nextRound, now)
    );
  }
}

export async function endTurn(gameId: string, ownerUserId: string) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  if (game.status !== "active") throw new EngineError("Game is not active", "invalid_state");
  const players = await loadPlayers(gameId);
  const result = advanceAfterEndTurn(
    {
      phase: game.phase,
      roundNumber: game.roundNumber,
      speakerPlayerId: game.speakerPlayerId,
      activePlayerId: game.activePlayerId,
      clockState: game.clockState,
      status: game.status,
    },
    players.map(toEnginePlayer)
  );

  const now = new Date();
  await applyActiveChange(
    game,
    result.activePlayerId,
    result.phase,
    game.roundNumber,
    now
  );
  return touchAndBroadcast(gameId);
}

export async function passTurn(gameId: string, ownerUserId: string) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  if (!game.activePlayerId) {
    throw new EngineError("No active player", "invalid_state");
  }
  const players = await loadPlayers(gameId);
  const result = advanceAfterPass(
    {
      phase: game.phase,
      roundNumber: game.roundNumber,
      speakerPlayerId: game.speakerPlayerId,
      activePlayerId: game.activePlayerId,
      clockState: game.clockState,
      status: game.status,
    },
    players.map(toEnginePlayer),
    game.activePlayerId
  );

  const now = new Date();
  if (result.playerUpdates) {
    for (const u of result.playerUpdates) {
      await db
        .update(lazaxPlayers)
        .set({
          actionState: u.actionState as ActionState,
          updatedAt: now,
        })
        .where(eq(lazaxPlayers.id, u.id));
    }
  }

  await applyActiveChange(
    game,
    result.activePlayerId,
    result.phase,
    game.roundNumber,
    now
  );
  return touchAndBroadcast(gameId);
}

export async function setActionState(
  gameId: string,
  ownerUserId: string,
  playerId: string,
  actionState: ActionState
) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  if (game.status !== "active") throw new EngineError("Game is not active", "invalid_state");
  const players = await loadPlayers(gameId);
  if (!players.some((p) => p.id === playerId)) {
    throw new EngineError("Player not in game", "bad_player");
  }
  await db
    .update(lazaxPlayers)
    .set({ actionState, updatedAt: new Date() })
    .where(and(eq(lazaxPlayers.id, playerId), eq(lazaxPlayers.gameId, gameId)));
  return touchAndBroadcast(gameId);
}

export async function exhaustStrategy(gameId: string, ownerUserId: string) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  if (!game.activePlayerId) throw new EngineError("No active player", "invalid_state");
  return setActionState(gameId, ownerUserId, game.activePlayerId, "exhausted");
}

export async function readyStrategy(gameId: string, ownerUserId: string) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  if (!game.activePlayerId) throw new EngineError("No active player", "invalid_state");
  return setActionState(gameId, ownerUserId, game.activePlayerId, "ready");
}

export async function advanceGamePhase(gameId: string, ownerUserId: string) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  const players = await loadPlayers(gameId);
  const result = advancePhase(
    {
      phase: game.phase,
      roundNumber: game.roundNumber,
      speakerPlayerId: game.speakerPlayerId,
      activePlayerId: game.activePlayerId,
      clockState: game.clockState,
      status: game.status,
    },
    players.map(toEnginePlayer)
  );

  const now = new Date();
  if (result.resetPlayers) {
    await db
      .update(lazaxPlayers)
      .set({
        strategyCard: null,
        actionState: "ready",
        updatedAt: now,
      })
      .where(eq(lazaxPlayers.gameId, gameId));
  } else if (result.phase === "action") {
    await db
      .update(lazaxPlayers)
      .set({ actionState: "ready", updatedAt: now })
      .where(eq(lazaxPlayers.gameId, gameId));
  }

  await applyActiveChange(
    game,
    result.activePlayerId,
    result.phase,
    result.roundNumber,
    now
  );
  return touchAndBroadcast(gameId);
}

export async function finishGame(gameId: string, ownerUserId: string) {
  const game = await requireOwnedGame(gameId, ownerUserId);
  const now = new Date();
  await closeOpenSegments(gameId, now);
  await db
    .update(lazaxGames)
    .set({
      status: "finished",
      clockState: "paused",
      activePlayerId: null,
      updatedAt: now,
    })
    .where(eq(lazaxGames.id, gameId));
  return touchAndBroadcast(gameId);
}

export async function getGameStats(gameId: string) {
  const [game] = await db
    .select()
    .from(lazaxGames)
    .where(eq(lazaxGames.id, gameId))
    .limit(1);
  if (!game) return null;
  const players = await loadPlayers(gameId);
  const segments = await db
    .select()
    .from(lazaxTimeSegments)
    .where(eq(lazaxTimeSegments.gameId, gameId))
    .orderBy(asc(lazaxTimeSegments.startedAt));
  const now = new Date();
  const stats = aggregateStats(segments, now);
  return {
    game: serializeGame(game),
    players: players.map(serializePlayer),
    ...stats,
    byPlayer: stats.byPlayer,
    byPhase: stats.byPhase,
    byRound: stats.byRound,
    segments: stats.segments.map((s) => ({
      ...s,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    })),
    serverNow: now.toISOString(),
  };
}
