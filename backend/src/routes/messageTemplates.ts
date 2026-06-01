import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { messageTemplates } from "../db/schema.js";

const templateInput = z.object({
  id: z.string().uuid(),
  title: z.string().max(200).nullable().optional(),
  body: z.string().max(4000).nullable().optional(),
  clientUpdatedAt: z.string().datetime(),
  deleted: z.boolean().optional(),
});

const upsertBody = z.object({
  templates: z.array(templateInput).max(500),
});

const querySchema = z.object({
  since: z.string().datetime().optional(),
});

function serialize(row: typeof messageTemplates.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

/**
 * Bulk upsert with last-write-wins by `clientUpdatedAt` — same shape as
 * `/expenses` so the Android outbox handler can be a near-clone.
 */
export const messageTemplateRoutes: FastifyPluginAsync = async (app) => {
  app.get("/message-templates", async (req) => {
    const q = querySchema.parse(req.query);
    const filters = [eq(messageTemplates.userId, req.auth.userId)];
    if (q.since) {
      filters.push(gt(messageTemplates.updatedAt, new Date(q.since)));
    }
    const rows = await db
      .select()
      .from(messageTemplates)
      .where(and(...filters))
      .orderBy(messageTemplates.createdAt);
    return rows.map(serialize);
  });

  app.put("/message-templates", async (req) => {
    const body = upsertBody.parse(req.body);
    if (body.templates.length === 0) return [];

    const userId = req.auth.userId;
    const results: Array<typeof messageTemplates.$inferSelect> = [];

    await db.transaction(async (tx) => {
      for (const t of body.templates) {
        const cua = new Date(t.clientUpdatedAt);

        if (t.deleted) {
          const [row] = await tx
            .update(messageTemplates)
            .set({
              deletedAt: new Date(),
              clientUpdatedAt: cua,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(messageTemplates.userId, userId),
                eq(messageTemplates.id, t.id),
                sql`${messageTemplates.clientUpdatedAt} < ${cua.toISOString()}`
              )
            )
            .returning();
          if (row) results.push(row);
          continue;
        }

        if (t.title == null || t.body == null) {
          // Non-delete payloads must carry the required fields.
          continue;
        }

        const [row] = await tx
          .insert(messageTemplates)
          .values({
            id: t.id,
            userId,
            title: t.title,
            body: t.body,
            clientUpdatedAt: cua,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: messageTemplates.id,
            set: {
              title: t.title,
              body: t.body,
              clientUpdatedAt: cua,
              updatedAt: new Date(),
              deletedAt: null,
            },
            setWhere: sql`${messageTemplates.clientUpdatedAt} < ${cua.toISOString()}`,
          })
          .returning();
        if (row) results.push(row);
      }
    });

    return results.map(serialize);
  });
};
