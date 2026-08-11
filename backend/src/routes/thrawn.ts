import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createLeague,
  deleteLeague,
  getLeagueAnalysis,
  getLeaguePlayerDetail,
  getLeagueRegression,
  getLeagueSeasonBoard,
  getLeagueValues,
  listLeagues,
  setOverride,
  syncLeague,
  ThrawnError,
  updateLeague,
} from "../thrawn/service.js";
import type { ThrawnLeague } from "../db/schema.js";

function serializeLeague(l: ThrawnLeague) {
  return {
    id: l.id,
    sleeperLeagueId: l.sleeperLeagueId,
    name: l.name,
    season: l.season,
    settings: l.settings,
    myRosterId: l.myRosterId,
    projectionSource: l.projectionSource,
    lastSyncedAt: l.lastSyncedAt ? l.lastSyncedAt.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  };
}

function mapError(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof ThrawnError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  throw err;
}

const idParams = z.object({ id: z.string().uuid() });

export const thrawnRoutes: FastifyPluginAsync = async (app) => {
  app.get("/thrawn/leagues", async (req) => {
    const rows = await listLeagues(req.auth.userId);
    return rows.map(serializeLeague);
  });

  app.post("/thrawn/leagues", async (req, reply) => {
    const body = z
      .object({ sleeperLeagueId: z.string().trim().regex(/^\d+$/) })
      .parse(req.body);
    try {
      const league = await createLeague(req.auth.userId, body.sleeperLeagueId);
      return reply.code(201).send(serializeLeague(league));
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.post("/thrawn/leagues/:id/sync", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    try {
      const league = await syncLeague(req.auth.userId, id);
      return serializeLeague(league);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.patch("/thrawn/leagues/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = z
      .object({
        myRosterId: z.number().int().min(1).nullable().optional(),
        projectionSource: z
          .enum(["sleeper", "espn", "sharks", "average"])
          .optional(),
      })
      .parse(req.body);
    try {
      const league = await updateLeague(req.auth.userId, id, body);
      return serializeLeague(league);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.delete("/thrawn/leagues/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    try {
      await deleteLeague(req.auth.userId, id);
      return { ok: true as const };
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get("/thrawn/leagues/:id/values", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    try {
      return await getLeagueValues(req.auth.userId, id);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get("/thrawn/leagues/:id/history/:season", async (req, reply) => {
    const params = z
      .object({ id: z.string().uuid(), season: z.string().regex(/^\d{4}$/) })
      .parse(req.params);
    try {
      return await getLeagueSeasonBoard(req.auth.userId, params.id, params.season);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get("/thrawn/leagues/:id/analysis", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    try {
      return await getLeagueAnalysis(req.auth.userId, id);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get("/thrawn/leagues/:id/players/:playerId/detail", async (req, reply) => {
    const params = z
      .object({ id: z.string().uuid(), playerId: z.string().min(1) })
      .parse(req.params);
    try {
      return await getLeaguePlayerDetail(
        req.auth.userId,
        params.id,
        params.playerId
      );
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.get("/thrawn/leagues/:id/regression", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const query = z
      .object({ season: z.string().regex(/^\d{4}$/).optional() })
      .parse(req.query);
    try {
      return await getLeagueRegression(req.auth.userId, id, query.season);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.put("/thrawn/leagues/:id/overrides/:playerId", async (req, reply) => {
    const params = z
      .object({ id: z.string().uuid(), playerId: z.string().min(1).max(16) })
      .parse(req.params);
    const body = z
      .object({
        points: z.number().min(0).max(1000).nullable(),
        note: z.string().trim().max(500).nullable().optional(),
      })
      .parse(req.body);
    try {
      return await setOverride(
        req.auth.userId,
        params.id,
        params.playerId,
        body.points,
        body.note ?? null
      );
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });
};
