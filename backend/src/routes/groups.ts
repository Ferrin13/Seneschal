import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { groups } from "../db/schema.js";

const groupInput = z.object({
  id: z.string().uuid(),
  name: z.string().max(200).nullable().optional(),
  clientUpdatedAt: z.string().datetime(),
  deleted: z.boolean().optional(),
});

const upsertBody = z.object({
  groups: z.array(groupInput).max(500),
});

const querySchema = z.object({
  since: z.string().datetime().optional(),
});

function serialize(row: typeof groups.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/**
 * Group-of-contacts metadata. Members live in `/group-members` and are
 * upserted independently to keep the wire format flat. Bulk upsert with
 * last-write-wins by `clientUpdatedAt`, matching `/expenses`.
 */
export const groupRoutes: FastifyPluginAsync = async (app) => {
  app.get("/groups", async (req) => {
    const q = querySchema.parse(req.query);
    const filters = [eq(groups.userId, req.auth.userId)];
    if (q.since) {
      filters.push(gt(groups.updatedAt, new Date(q.since)));
    }
    const rows = await db
      .select()
      .from(groups)
      .where(and(...filters))
      .orderBy(groups.createdAt);
    return rows.map(serialize);
  });

  app.put("/groups", async (req) => {
    const body = upsertBody.parse(req.body);
    if (body.groups.length === 0) return [];

    const userId = req.auth.userId;
    const results: Array<typeof groups.$inferSelect> = [];

    await db.transaction(async (tx) => {
      for (const g of body.groups) {
        const cua = new Date(g.clientUpdatedAt);

        if (g.deleted) {
          const [row] = await tx
            .update(groups)
            .set({
              deletedAt: new Date(),
              clientUpdatedAt: cua,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(groups.userId, userId),
                eq(groups.id, g.id),
                sql`${groups.clientUpdatedAt} < ${cua.toISOString()}`
              )
            )
            .returning();
          if (row) results.push(row);
          continue;
        }

        if (g.name == null) {
          continue;
        }

        const [row] = await tx
          .insert(groups)
          .values({
            id: g.id,
            userId,
            name: g.name,
            clientUpdatedAt: cua,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: groups.id,
            set: {
              name: g.name,
              clientUpdatedAt: cua,
              updatedAt: new Date(),
              deletedAt: null,
            },
            setWhere: sql`${groups.clientUpdatedAt} < ${cua.toISOString()}`,
          })
          .returning();
        if (row) results.push(row);
      }
    });

    return results.map(serialize);
  });
};
