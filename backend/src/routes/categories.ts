import type { FastifyPluginAsync } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { categories } from "../db/schema.js";

const KIND = z.enum([
  "good",
  "necessary_good",
  "necessary_inconvenient",
  "good_entertainment",
  "not_best",
  "waste",
  "spiritual",
]);

const createBody = z.object({
  name: z.string().min(1).max(80),
  kind: KIND,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  sortOrder: z.number().int().nonnegative().default(0),
  clientUpdatedAt: z.string().datetime().optional(),
});

const patchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  kind: KIND.optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  clientUpdatedAt: z.string().datetime().optional(),
});

const querySchema = z.object({
  since: z.string().datetime().optional(),
  includeDeleted: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
});

function serialize(row: typeof categories.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/categories", async (req) => {
    const q = querySchema.parse(req.query);
    const filters = [eq(categories.userId, req.auth.userId)];
    if (q.since) filters.push(gt(categories.updatedAt, new Date(q.since)));
    if (!q.includeDeleted) filters.push(isNull(categories.deletedAt));

    const rows = await db
      .select()
      .from(categories)
      .where(and(...filters))
      .orderBy(categories.sortOrder, categories.name);
    return rows.map(serialize);
  });

  app.post("/categories", async (req, reply) => {
    const body = createBody.parse(req.body);
    const [row] = await db
      .insert(categories)
      .values({
        userId: req.auth.userId,
        name: body.name,
        kind: body.kind,
        color: body.color,
        sortOrder: body.sortOrder,
        clientUpdatedAt: body.clientUpdatedAt
          ? new Date(body.clientUpdatedAt)
          : new Date(),
      })
      .returning();
    return reply.code(201).send(serialize(row!));
  });

  app.patch<{ Params: { id: string } }>(
    "/categories/:id",
    async (req, reply) => {
      const body = patchBody.parse(req.body);
      const [row] = await db
        .update(categories)
        .set({
          ...body,
          updatedAt: new Date(),
          clientUpdatedAt: body.clientUpdatedAt
            ? new Date(body.clientUpdatedAt)
            : new Date(),
        })
        .where(
          and(
            eq(categories.id, req.params.id),
            eq(categories.userId, req.auth.userId)
          )
        )
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return serialize(row);
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/categories/:id",
    async (req, reply) => {
      const [row] = await db
        .update(categories)
        .set({
          deletedAt: new Date(),
          isActive: false,
          updatedAt: new Date(),
          clientUpdatedAt: new Date(),
        })
        .where(
          and(
            eq(categories.id, req.params.id),
            eq(categories.userId, req.auth.userId)
          )
        )
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    }
  );
};
