import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { roleWeightsSchema, scoresSchema, weightsSchema } from "../moneyball/engine.js";
import {
  type BoardOptions,
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

/**
 * `?excludeRaters=<uuid>,<uuid>` (or repeated) — raters the viewer wants left
 * out of the consensus. Purely a read-side view option; nothing is stored.
 */
const raterFilterQuery = z.object({
  excludeRaters: z.union([z.string(), z.array(z.string())]).optional(),
});

function parseBoardOptions(query: unknown): BoardOptions {
  const { excludeRaters } = raterFilterQuery.parse(query);
  if (excludeRaters == null) return {};
  const raw = Array.isArray(excludeRaters) ? excludeRaters : [excludeRaters];
  const ids = raw
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return { excludeRaters: z.array(z.string().uuid()).max(200).parse(ids) };
}

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
  /**
   * Roster + team means + scores + the caller's own ratings, in one shot.
   * `?excludeRaters=` drops the named raters from every consensus figure.
   */
  app.get("/moneyball/board", async (req) =>
    getBoard(req.auth.userId, parseBoardOptions(req.query))
  );

  /**
   * Per-team summaries: average by stat, best players, best O/D lines,
   * leaders. Takes the same `?excludeRaters=` as the board so the Teams and
   * Concentration tabs reflect the viewer's rater filter.
   */
  app.get("/moneyball/teams", async (req) =>
    getTeams(req.auth.userId, parseBoardOptions(req.query))
  );

  app.get("/moneyball/players/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    try {
      return await getPlayerDetail(req.auth.userId, id, parseBoardOptions(req.query));
    } catch (err) {
      const mapped = mapError(err);
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  /**
   * Replace the caller's rating for a player. Empty scores clears it. Accepts
   * the same `?excludeRaters=` as the board so the returned detail matches
   * the view the client is patching.
   */
  app.put("/moneyball/players/:id/rating", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ scores: scoresSchema }).parse(req.body);
    try {
      return await upsertMyRating(
        req.auth.userId,
        id,
        body.scores,
        parseBoardOptions(req.query)
      );
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
