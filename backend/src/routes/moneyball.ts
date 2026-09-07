import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { roleWeightsSchema, scoresSchema, weightsSchema } from "../moneyball/engine.js";
import {
  deleteMyRating,
  getBoard,
  getPlayerDetail,
  getRoleWeights,
  getTeams,
  getWeights,
  MoneyballError,
  setRoleWeights,
  setWeights,
  upsertMyRating,
} from "../moneyball/service.js";

const idParams = z.object({ id: z.string().uuid() });

function mapError(err: unknown): { status: number; body: { error: string; code?: string } } {
  if (err instanceof MoneyballError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  throw err;
}

/**
 * Moneyball REST surface. Everything is gated by the `moneyball` feature via
 * the `/moneyball` prefix in auth/access.ts; there is no per-object ownership
 * because the roster and weights are shared. Ratings are always the caller's.
 */
export const moneyballRoutes: FastifyPluginAsync = async (app) => {
  /** Roster + team means + scores + the caller's own ratings, in one shot. */
  app.get("/moneyball/board", async (req) => getBoard(req.auth.userId));

  /** Per-team summaries: average by stat, best players, best O/D lines, leaders. */
  app.get("/moneyball/teams", async (req) => getTeams(req.auth.userId));

  app.get("/moneyball/players/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    try {
      return await getPlayerDetail(req.auth.userId, id);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  /** Replace the caller's rating for a player. Empty scores clears it. */
  app.put("/moneyball/players/:id/rating", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ scores: scoresSchema }).parse(req.body);
    try {
      return await upsertMyRating(req.auth.userId, id, body.scores);
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  app.delete("/moneyball/players/:id/rating", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    await deleteMyRating(req.auth.userId, id);
    return reply.code(204).send();
  });

  app.get("/moneyball/weights", async () => ({
    weights: await getWeights(),
    roleWeights: await getRoleWeights(),
  }));

  /**
   * Save the shared formula. `roleWeights` (the per-role stat weight tables
   * behind the handler/cutter/defender OVRs) is optional so older clients
   * that only send `weights` keep working.
   */
  app.put("/moneyball/weights", async (req) => {
    const body = z
      .object({ weights: weightsSchema, roleWeights: roleWeightsSchema.optional() })
      .parse(req.body);
    const weights = await setWeights(req.auth.userId, body.weights);
    const roleWeights = body.roleWeights
      ? await setRoleWeights(req.auth.userId, body.roleWeights)
      : await getRoleWeights();
    return { weights, roleWeights };
  });
};
