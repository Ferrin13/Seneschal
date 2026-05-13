import type { FastifyPluginAsync } from "fastify";
import { and, between, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { timeSlots } from "../db/schema.js";
import { isSlotAligned } from "../util/time.js";

const slotInput = z.object({
  slotStartUtc: z
    .string()
    .datetime()
    .refine((s) => isSlotAligned(new Date(s)), {
      message: "slotStartUtc must be aligned to a 15-minute boundary",
    }),
  primaryActivityId: z.string().uuid().nullable(),
  secondaryActivityId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  clientUpdatedAt: z.string().datetime(),
  deleted: z.boolean().optional(),
});

const upsertBody = z.object({
  slots: z.array(slotInput).max(2000),
});

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  since: z.string().datetime().optional(),
});

function serialize(row: typeof timeSlots.$inferSelect) {
  return {
    slotStartUtc: row.slotStartUtc.toISOString(),
    primaryActivityId: row.primaryActivityId,
    secondaryActivityId: row.secondaryActivityId,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
    clientUpdatedAt: row.clientUpdatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export const slotRoutes: FastifyPluginAsync = async (app) => {
  app.get("/slots", async (req) => {
    const q = querySchema.parse(req.query);
    const filters = [eq(timeSlots.userId, req.auth.userId)];
    if (q.from && q.to) {
      filters.push(
        between(timeSlots.slotStartUtc, new Date(q.from), new Date(q.to))
      );
    }
    if (q.since) {
      filters.push(gt(timeSlots.updatedAt, new Date(q.since)));
    }
    const rows = await db
      .select()
      .from(timeSlots)
      .where(and(...filters))
      .orderBy(timeSlots.slotStartUtc);
    return rows.map(serialize);
  });

  /**
   * Bulk upsert with last-write-wins by clientUpdatedAt. Stale offline
   * writes lose silently (the WHERE clause skips the update). A
   * `deleted: true` flag soft-deletes an existing slot; for non-existent
   * deleted rows we have nothing to do.
   */
  app.put("/slots", async (req) => {
    const body = upsertBody.parse(req.body);
    if (body.slots.length === 0) return [];

    const userId = req.auth.userId;
    const results: Array<typeof timeSlots.$inferSelect> = [];

    await db.transaction(async (tx) => {
      for (const s of body.slots) {
        const cua = new Date(s.clientUpdatedAt);
        const slotTs = new Date(s.slotStartUtc);

        if (s.deleted) {
          const [row] = await tx
            .update(timeSlots)
            .set({
              deletedAt: new Date(),
              clientUpdatedAt: cua,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(timeSlots.userId, userId),
                eq(timeSlots.slotStartUtc, slotTs),
                sql`${timeSlots.clientUpdatedAt} < ${cua.toISOString()}`
              )
            )
            .returning();
          if (row) results.push(row);
          continue;
        }

        if (!s.primaryActivityId) continue; // nothing to do

        const [row] = await tx
          .insert(timeSlots)
          .values({
            userId,
            slotStartUtc: slotTs,
            primaryActivityId: s.primaryActivityId,
            secondaryActivityId: s.secondaryActivityId ?? null,
            notes: s.notes ?? null,
            clientUpdatedAt: cua,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [timeSlots.userId, timeSlots.slotStartUtc],
            set: {
              primaryActivityId: s.primaryActivityId,
              secondaryActivityId: s.secondaryActivityId ?? null,
              notes: s.notes ?? null,
              clientUpdatedAt: cua,
              updatedAt: new Date(),
              deletedAt: null,
            },
            setWhere: sql`${timeSlots.clientUpdatedAt} < ${cua.toISOString()}`,
          })
          .returning();
        if (row) results.push(row);
      }
    });

    return results.map(serialize);
  });
};
