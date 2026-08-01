import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { EngineError } from "../lazax/engine.js";
import { FACTIONS, STRATEGY_CARDS } from "../lazax/factions.js";
import {
  advanceGamePhase,
  assignStrategyCard,
  createGame,
  endTurn,
  exhaustStrategy,
  finishGame,
  getGameStats,
  getSnapshot,
  listGames,
  passTurn,
  pauseGame,
  readyStrategy,
  resumeGame,
  setActionState,
  setActivePlayer,
  setSpeaker,
  startGame,
} from "../lazax/service.js";

function mapError(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof EngineError) {
    let status = 400;
    if (err.code === "not_paused" || err.code === "not_running") status = 409;
    if (err.message.includes("game owner")) status = 403;
    if (err.message === "Game not found") status = 404;
    return { status, body: { error: err.message, code: err.code } };
  }
  throw err;
}

const playerInput = z.object({
  displayName: z.string().trim().min(1).max(80),
  factionId: z.string().min(1).max(40),
  seatIndex: z.number().int().min(0).max(7),
});

const createBody = z.object({
  name: z.string().trim().max(120).optional(),
  players: z.array(playerInput).min(3).max(8),
  speakerSeatIndex: z.number().int().min(0).max(7),
});

export const lazaxRoutes: FastifyPluginAsync = async (app) => {
  app.get("/lazax/factions", async () => ({
    factions: FACTIONS,
    strategyCards: STRATEGY_CARDS,
  }));

  app.get("/lazax/games", async (req) => {
    return listGames(req.auth.userId);
  });

  app.post("/lazax/games", async (req, reply) => {
    try {
      const body = createBody.parse(req.body);
      const snap = await createGame(
        req.auth.userId,
        body.name ?? "Twilight Imperium",
        body.players,
        body.speakerSeatIndex
      );
      return reply.code(201).send(snap);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get("/lazax/games/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const snap = await getSnapshot(id);
    if (!snap) return reply.code(404).send({ error: "not_found" });
    return snap;
  });

  app.get("/lazax/games/:id/stats", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const stats = await getGameStats(id);
    if (!stats) return reply.code(404).send({ error: "not_found" });
    return stats;
  });

  const idParams = z.object({ id: z.string().uuid() });

  async function ownerAction(
    req: { auth: { userId: string }; params: unknown; body?: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    fn: (gameId: string, userId: string) => Promise<unknown>
  ) {
    try {
      const { id } = idParams.parse(req.params);
      return await fn(id, req.auth.userId);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  }

  app.post("/lazax/games/:id/start", async (req, reply) =>
    ownerAction(req, reply, startGame)
  );
  app.post("/lazax/games/:id/pause", async (req, reply) =>
    ownerAction(req, reply, pauseGame)
  );
  app.post("/lazax/games/:id/resume", async (req, reply) =>
    ownerAction(req, reply, resumeGame)
  );
  app.post("/lazax/games/:id/end-turn", async (req, reply) =>
    ownerAction(req, reply, endTurn)
  );
  app.post("/lazax/games/:id/pass", async (req, reply) =>
    ownerAction(req, reply, passTurn)
  );
  app.post("/lazax/games/:id/exhaust", async (req, reply) =>
    ownerAction(req, reply, exhaustStrategy)
  );
  app.post("/lazax/games/:id/ready", async (req, reply) =>
    ownerAction(req, reply, readyStrategy)
  );
  app.post("/lazax/games/:id/advance-phase", async (req, reply) =>
    ownerAction(req, reply, advanceGamePhase)
  );
  app.post("/lazax/games/:id/finish", async (req, reply) =>
    ownerAction(req, reply, finishGame)
  );

  app.post("/lazax/games/:id/active-player", async (req, reply) => {
    try {
      const { id } = idParams.parse(req.params);
      const body = z.object({ playerId: z.string().uuid() }).parse(req.body);
      return await setActivePlayer(id, req.auth.userId, body.playerId);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post("/lazax/games/:id/speaker", async (req, reply) => {
    try {
      const { id } = idParams.parse(req.params);
      const body = z.object({ playerId: z.string().uuid() }).parse(req.body);
      return await setSpeaker(id, req.auth.userId, body.playerId);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post("/lazax/games/:id/strategy-card", async (req, reply) => {
    try {
      const { id } = idParams.parse(req.params);
      const body = z
        .object({
          playerId: z.string().uuid(),
          card: z.number().int().min(1).max(8).nullable(),
        })
        .parse(req.body);
      return await assignStrategyCard(id, req.auth.userId, body.playerId, body.card);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post("/lazax/games/:id/action-state", async (req, reply) => {
    try {
      const { id } = idParams.parse(req.params);
      const body = z
        .object({
          playerId: z.string().uuid(),
          actionState: z.enum(["ready", "exhausted", "passed"]),
        })
        .parse(req.body);
      return await setActionState(
        id,
        req.auth.userId,
        body.playerId,
        body.actionState
      );
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });
};
