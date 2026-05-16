import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { businesses } from "../db/schema.js";

const querySchema = z.object({
  since: z.string().datetime().optional(),
  includeDeleted: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
});

function serialize(row: typeof businesses.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/**
 * Read-only API surface for the seeded business "enum". Mutation endpoints
 * are intentionally absent for v1 — businesses are seeded by
 * `seedUserDefaults` and edited via SQL when needed.
 */
export const businessRoutes: FastifyPluginAsync = async (app) => {
  app.get("/businesses", async (req) => {
    const q = querySchema.parse(req.query);
    const filters = [eq(businesses.userId, req.auth.userId)];
    if (q.since) filters.push(gt(businesses.updatedAt, new Date(q.since)));
    if (!q.includeDeleted) filters.push(isNull(businesses.deletedAt));

    const rows = await db
      .select()
      .from(businesses)
      .where(and(...filters))
      .orderBy(businesses.sortOrder, businesses.name);
    return rows.map(serialize);
  });
};
