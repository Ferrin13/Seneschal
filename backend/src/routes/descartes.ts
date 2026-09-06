import type { FastifyPluginAsync } from "fastify";
import { changeSet, graph } from "../descartes/schemas.js";
import {
  applyChanges,
  DescartesError,
  getGraph,
  replaceGraph,
} from "../descartes/service.js";

/**
 * Descartes belief graph. The graph is small and edited interactively, so the
 * API is document-shaped: fetch it whole, push batched change-sets, or
 * replace it outright. All rows are scoped to the authenticated user.
 */
export const descartesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/descartes/graph", async (req) => {
    return getGraph(req.auth.userId);
  });

  app.post("/descartes/graph/changes", async (req, reply) => {
    const body = changeSet.parse(req.body);
    try {
      await applyChanges(req.auth.userId, body);
    } catch (err) {
      if (err instanceof DescartesError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }
    return { ok: true, appliedAt: new Date().toISOString() };
  });

  app.put("/descartes/graph", async (req, reply) => {
    const body = graph.parse(req.body);
    try {
      await replaceGraph(req.auth.userId, body);
    } catch (err) {
      if (err instanceof DescartesError) {
        return reply.code(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }
    return getGraph(req.auth.userId);
  });
};
