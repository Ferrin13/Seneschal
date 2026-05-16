import type { FastifyPluginAsync } from "fastify";
import { and, between, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { businesses, expenses } from "../db/schema.js";

// Most fields are `.nullable().optional()` because the Android client uses
// Moshi, which omits null fields from JSON by default. A delete payload
// therefore arrives carrying only `id`, `clientUpdatedAt`, and `deleted`.
const expenseInput = z.object({
  id: z.string().uuid(),
  businessId: z.string().uuid().nullable().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  amountCents: z.number().int().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  imageKey: z.string().max(512).nullable().optional(),
  clientUpdatedAt: z.string().datetime(),
  deleted: z.boolean().optional(),
});

const upsertBody = z.object({
  expenses: z.array(expenseInput).max(500),
});

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  since: z.string().datetime().optional(),
});

function serialize(row: typeof expenses.$inferSelect) {
  return {
    id: row.id,
    businessId: row.businessId,
    occurredAt: row.occurredAt.toISOString(),
    amountCents: row.amountCents,
    note: row.note,
    imageKey: row.imageKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

async function assertBusinessOwned(userId: string, businessId: string) {
  const [b] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
    .limit(1);
  if (!b) {
    const err = new Error("business_not_found") as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Bulk upsert with last-write-wins by `clientUpdatedAt` — mirrors the
 * `/slots` semantics so the client outbox can use the same retry logic.
 *
 * The client supplies the row id (UUID generated on-device) so an offline
 * insert and a later edit both round-trip cleanly.
 */
export const expenseRoutes: FastifyPluginAsync = async (app) => {
  app.get("/expenses", async (req) => {
    const q = querySchema.parse(req.query);
    const filters = [eq(expenses.userId, req.auth.userId)];
    if (q.from && q.to) {
      filters.push(
        between(expenses.occurredAt, new Date(q.from), new Date(q.to))
      );
    }
    if (q.since) {
      filters.push(gt(expenses.updatedAt, new Date(q.since)));
    }
    const rows = await db
      .select()
      .from(expenses)
      .where(and(...filters))
      .orderBy(expenses.occurredAt);
    return rows.map(serialize);
  });

  app.put("/expenses", async (req) => {
    const body = upsertBody.parse(req.body);
    if (body.expenses.length === 0) return [];

    const userId = req.auth.userId;
    const results: Array<typeof expenses.$inferSelect> = [];

    // Validate business ownership up front so the transaction doesn't
    // start work it can't finish.
    const businessIds = new Set(
      body.expenses
        .map((e) => e.businessId)
        .filter((b): b is string => !!b)
    );
    for (const id of businessIds) {
      await assertBusinessOwned(userId, id);
    }

    await db.transaction(async (tx) => {
      for (const e of body.expenses) {
        const cua = new Date(e.clientUpdatedAt);

        if (e.deleted) {
          const [row] = await tx
            .update(expenses)
            .set({
              deletedAt: new Date(),
              clientUpdatedAt: cua,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(expenses.userId, userId),
                eq(expenses.id, e.id),
                sql`${expenses.clientUpdatedAt} < ${cua.toISOString()}`
              )
            )
            .returning();
          if (row) results.push(row);
          continue;
        }

        if (!e.businessId || !e.occurredAt) {
          // Non-delete payloads must carry the required fields.
          continue;
        }

        const occurredAt = new Date(e.occurredAt);

        const [row] = await tx
          .insert(expenses)
          .values({
            id: e.id,
            userId,
            businessId: e.businessId,
            occurredAt,
            amountCents: e.amountCents ?? null,
            note: e.note ?? null,
            imageKey: e.imageKey ?? null,
            clientUpdatedAt: cua,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: expenses.id,
            set: {
              businessId: e.businessId,
              occurredAt,
              amountCents: e.amountCents ?? null,
              note: e.note ?? null,
              imageKey: e.imageKey ?? null,
              clientUpdatedAt: cua,
              updatedAt: new Date(),
              deletedAt: null,
            },
            setWhere: sql`${expenses.clientUpdatedAt} < ${cua.toISOString()}`,
          })
          .returning();
        if (row) results.push(row);
      }
    });

    return results.map(serialize);
  });
};
