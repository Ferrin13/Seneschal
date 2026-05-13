import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { activities, categories } from "../db/schema.js";

const createBody = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(80),
  sortOrder: z.number().int().nonnegative().default(0),
  clientUpdatedAt: z.string().datetime().optional(),
});

const patchBody = z.object({
  categoryId: z.string().uuid().optional(),
  name: z.string().min(1).max(80).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  archived: z.boolean().optional(),
  clientUpdatedAt: z.string().datetime().optional(),
});

const querySchema = z.object({
  since: z.string().datetime().optional(),
  includeDeleted: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
});

function serialize(row: typeof activities.$inferSelect) {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

async function assertCategoryOwned(userId: string, categoryId: string) {
  const [c] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  if (!c) {
    const err = new Error("category_not_found") as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }
}

export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.get("/activities", async (req) => {
    const q = querySchema.parse(req.query);
    const filters = [eq(activities.userId, req.auth.userId)];
    if (q.since) filters.push(gt(activities.updatedAt, new Date(q.since)));
    if (!q.includeDeleted) filters.push(isNull(activities.deletedAt));

    const rows = await db
      .select()
      .from(activities)
      .where(and(...filters))
      .orderBy(activities.sortOrder, activities.name);
    return rows.map(serialize);
  });

  app.post("/activities", async (req, reply) => {
    const body = createBody.parse(req.body);
    await assertCategoryOwned(req.auth.userId, body.categoryId);
    const [row] = await db
      .insert(activities)
      .values({
        userId: req.auth.userId,
        categoryId: body.categoryId,
        name: body.name,
        sortOrder: body.sortOrder,
        clientUpdatedAt: body.clientUpdatedAt
          ? new Date(body.clientUpdatedAt)
          : new Date(),
      })
      .returning();
    return reply.code(201).send(serialize(row!));
  });

  app.patch<{ Params: { id: string } }>(
    "/activities/:id",
    async (req, reply) => {
      const body = patchBody.parse(req.body);
      if (body.categoryId) {
        await assertCategoryOwned(req.auth.userId, body.categoryId);
      }
      const updates: Partial<typeof activities.$inferInsert> = {
        updatedAt: new Date(),
        clientUpdatedAt: body.clientUpdatedAt
          ? new Date(body.clientUpdatedAt)
          : new Date(),
      };
      if (body.categoryId !== undefined) updates.categoryId = body.categoryId;
      if (body.name !== undefined) updates.name = body.name;
      if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
      if (body.isActive !== undefined) updates.isActive = body.isActive;
      if (body.archived !== undefined) {
        updates.archivedAt = body.archived ? new Date() : null;
      }

      const [row] = await db
        .update(activities)
        .set(updates)
        .where(
          and(
            eq(activities.id, req.params.id),
            eq(activities.userId, req.auth.userId)
          )
        )
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return serialize(row);
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/activities/:id",
    async (req, reply) => {
      const [row] = await db
        .update(activities)
        .set({
          deletedAt: new Date(),
          isActive: false,
          updatedAt: new Date(),
          clientUpdatedAt: new Date(),
        })
        .where(
          and(
            eq(activities.id, req.params.id),
            eq(activities.userId, req.auth.userId)
          )
        )
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    }
  );
};
