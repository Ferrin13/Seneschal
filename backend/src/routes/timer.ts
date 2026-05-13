import type { FastifyPluginAsync } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { runningTimers, timeSlots } from "../db/schema.js";
import { slotsCoveredByMidpoint } from "../util/time.js";

const startBody = z.object({
  primaryActivityId: z.string().uuid(),
  secondaryActivityId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  startedAt: z.string().datetime().optional(),
});

const stopBody = z.object({
  stoppedAt: z.string().datetime().optional(),
});

function serializeTimer(row: typeof runningTimers.$inferSelect) {
  return {
    primaryActivityId: row.primaryActivityId,
    secondaryActivityId: row.secondaryActivityId,
    notes: row.notes,
    startedAt: row.startedAt.toISOString(),
  };
}

export const timerRoutes: FastifyPluginAsync = async (app) => {
  app.get("/timer", async (req, reply) => {
    const [row] = await db
      .select()
      .from(runningTimers)
      .where(eq(runningTimers.userId, req.auth.userId))
      .limit(1);
    if (!row) return reply.code(204).send();
    return serializeTimer(row);
  });

  /**
   * Start (or replace) the running timer. Replacing an existing timer
   * silently overwrites it; the client is expected to call /timer/stop
   * first when it cares about the previous run.
   */
  app.post("/timer/start", async (req) => {
    const body = startBody.parse(req.body);
    const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
    const [row] = await db
      .insert(runningTimers)
      .values({
        userId: req.auth.userId,
        primaryActivityId: body.primaryActivityId,
        secondaryActivityId: body.secondaryActivityId ?? null,
        notes: body.notes ?? null,
        startedAt,
      })
      .onConflictDoUpdate({
        target: runningTimers.userId,
        set: {
          primaryActivityId: body.primaryActivityId,
          secondaryActivityId: body.secondaryActivityId ?? null,
          notes: body.notes ?? null,
          startedAt,
        },
      })
      .returning();
    return serializeTimer(row!);
  });

  /**
   * Stop the timer. Atomically: read the active timer, compute the slots
   * its midpoint-coverage hits, upsert each slot (LWW), then delete the
   * timer row. Returns the affected slots so the client can merge them.
   */
  app.post("/timer/stop", async (req, reply) => {
    const body = stopBody.parse(req.body);
    const stoppedAt = body.stoppedAt ? new Date(body.stoppedAt) : new Date();
    const userId = req.auth.userId;

    const result = await db.transaction(async (tx) => {
      const [active] = await tx
        .select()
        .from(runningTimers)
        .where(eq(runningTimers.userId, userId))
        .limit(1);
      if (!active) return null;

      const covered = slotsCoveredByMidpoint(active.startedAt, stoppedAt);
      const written: Array<typeof timeSlots.$inferSelect> = [];
      for (const slotStart of covered) {
        const cua = stoppedAt;
        const [row] = await tx
          .insert(timeSlots)
          .values({
            userId,
            slotStartUtc: slotStart,
            primaryActivityId: active.primaryActivityId,
            secondaryActivityId: active.secondaryActivityId,
            notes: active.notes,
            clientUpdatedAt: cua,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [timeSlots.userId, timeSlots.slotStartUtc],
            set: {
              primaryActivityId: active.primaryActivityId,
              secondaryActivityId: active.secondaryActivityId,
              notes: active.notes,
              clientUpdatedAt: cua,
              updatedAt: new Date(),
              deletedAt: null,
            },
            setWhere: sql`${timeSlots.clientUpdatedAt} < ${cua.toISOString()}`,
          })
          .returning();
        if (row) written.push(row);
      }

      await tx
        .delete(runningTimers)
        .where(and(eq(runningTimers.userId, userId)));

      return { written, startedAt: active.startedAt, stoppedAt };
    });

    if (!result) return reply.code(204).send();
    return {
      startedAt: result.startedAt.toISOString(),
      stoppedAt: result.stoppedAt.toISOString(),
      slots: result.written.map((row) => ({
        slotStartUtc: row.slotStartUtc.toISOString(),
        primaryActivityId: row.primaryActivityId,
        secondaryActivityId: row.secondaryActivityId,
        notes: row.notes,
        updatedAt: row.updatedAt.toISOString(),
        clientUpdatedAt: row.clientUpdatedAt.toISOString(),
      })),
    };
  });
};
