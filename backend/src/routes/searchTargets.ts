import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { searchTargets, searches, huntRuns } from "../db/schema.js";
import {
  expandTarget,
  toPlatformSearches,
  type SearchFilters,
} from "../marketplace/searchExpansion.js";
import { getModelOverrides, pickModel } from "../marketplace/modelSettings.js";
import {
  effectiveIntervalMin,
  ensureHuntSchedule,
  removeHuntSchedule,
} from "../temporal/schedules.js";

// Bounds for a target's auto-hunt cadence (minutes): at least every 5 minutes,
// at most once a day. Keeps schedules sane and avoids hammering marketplaces.
const MIN_INTERVAL_MIN = 5;
const MAX_INTERVAL_MIN = 1440;

const createBody = z.object({
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(4000),
  evalInstructions: z.string().max(4000).nullable().optional(),
  huntIntervalMin: z
    .number()
    .int()
    .min(MIN_INTERVAL_MIN)
    .max(MAX_INTERVAL_MIN)
    .nullable()
    .optional(),
});

const updateBody = z.object({
  title: z.string().min(1).max(200).optional(),
  prompt: z.string().min(1).max(4000).optional(),
  evalInstructions: z.string().max(4000).nullable().optional(),
  isActive: z.boolean().optional(),
  huntIntervalMin: z
    .number()
    .int()
    .min(MIN_INTERVAL_MIN)
    .max(MAX_INTERVAL_MIN)
    .nullable()
    .optional(),
});

function serialize(row: typeof searchTargets.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    evalInstructions: row.evalInstructions,
    isActive: row.isActive,
    // Always report the effective cadence the schedule actually runs at.
    huntIntervalMin: effectiveIntervalMin(row.huntIntervalMin),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeRun(row: typeof huntRuns.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    searches: row.searches,
    discovered: row.discovered,
    triaged: row.triaged,
    promising: row.promising,
    evaluated: row.evaluated,
    errors: row.errors,
    costUsd: row.costUsd,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

function serializeSearch(row: typeof searches.$inferSelect) {
  return {
    id: row.id,
    targetId: row.targetId,
    platform: row.platform,
    query: row.query,
    filters: row.filters,
    searchUrl: row.searchUrl,
    source: row.source,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadOwnedTarget(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(searchTargets)
    .where(
      and(
        eq(searchTargets.id, id),
        eq(searchTargets.userId, userId),
        isNull(searchTargets.deletedAt)
      )
    )
    .limit(1);
  if (!row) {
    const err = new Error("target_not_found") as Error & {
      statusCode: number;
    };
    err.statusCode = 404;
    throw err;
  }
  return row;
}

/**
 * CRUD for natural-language shopping targets, plus an LLM-backed endpoint to
 * expand a target into concrete Marketplace searches.
 */
export const searchTargetRoutes: FastifyPluginAsync = async (app) => {
  app.get("/marketplace/targets", async (req) => {
    const rows = await db
      .select()
      .from(searchTargets)
      .where(
        and(
          eq(searchTargets.userId, req.auth.userId),
          isNull(searchTargets.deletedAt)
        )
      )
      .orderBy(desc(searchTargets.createdAt));
    return rows.map(serialize);
  });

  app.post("/marketplace/targets", async (req) => {
    const body = createBody.parse(req.body);
    const [row] = await db
      .insert(searchTargets)
      .values({
        userId: req.auth.userId,
        title: body.title,
        prompt: body.prompt,
        evalInstructions: body.evalInstructions ?? null,
        huntIntervalMin: body.huntIntervalMin ?? null,
      })
      .returning();
    // Register the recurring hunt schedule (best-effort; worker also syncs).
    await ensureHuntSchedule({
      userId: req.auth.userId,
      targetId: row!.id,
      intervalMin: effectiveIntervalMin(row!.huntIntervalMin),
      paused: !row!.isActive,
    }).catch(() => undefined);
    return serialize(row!);
  });

  app.patch("/marketplace/targets/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateBody.parse(req.body);
    await loadOwnedTarget(req.auth.userId, id);

    const [row] = await db
      .update(searchTargets)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
        ...(body.evalInstructions !== undefined
          ? { evalInstructions: body.evalInstructions }
          : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.huntIntervalMin !== undefined
          ? { huntIntervalMin: body.huntIntervalMin }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(searchTargets.id, id))
      .returning();
    // Reconcile the schedule with the target: pause/unpause via isActive and
    // apply any cadence change. The schedule is kept around either way.
    if (body.isActive !== undefined || body.huntIntervalMin !== undefined) {
      await ensureHuntSchedule({
        userId: req.auth.userId,
        targetId: id,
        intervalMin: effectiveIntervalMin(row!.huntIntervalMin),
        paused: !row!.isActive,
      }).catch(() => undefined);
    }
    return serialize(row!);
  });

  app.delete("/marketplace/targets/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await loadOwnedTarget(req.auth.userId, id);
    await db
      .update(searchTargets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(searchTargets.id, id));
    await removeHuntSchedule({ userId: req.auth.userId, targetId: id }).catch(
      () => undefined
    );
    return { ok: true };
  });

  app.get("/marketplace/targets/:id/searches", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await loadOwnedTarget(req.auth.userId, id);
    const rows = await db
      .select()
      .from(searches)
      .where(
        and(
          eq(searches.userId, req.auth.userId),
          eq(searches.targetId, id),
          isNull(searches.deletedAt)
        )
      )
      .orderBy(desc(searches.createdAt));
    return rows.map(serializeSearch);
  });

  /** Recent auto/manual hunt runs for a target (newest first) from mp_hunt_runs. */
  app.get("/marketplace/targets/:id/runs", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(req.query);
    await loadOwnedTarget(req.auth.userId, id);
    const rows = await db
      .select()
      .from(huntRuns)
      .where(
        and(eq(huntRuns.userId, req.auth.userId), eq(huntRuns.targetId, id))
      )
      .orderBy(desc(huntRuns.startedAt))
      .limit(limit);
    return rows.map(serializeRun);
  });

  /**
   * Expand the target into concrete searches via the LLM and persist them.
   * Idempotency is intentionally loose for v1: each call appends a fresh set,
   * so callers should clear/deactivate prior searches if re-running.
   */
  app.post("/marketplace/targets/:id/expand", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ model: z.string().min(1).max(200).optional() })
      .optional()
      .parse(req.body);
    const target = await loadOwnedTarget(req.auth.userId, id);

    const overrides = await getModelOverrides(req.auth.userId);
    const expanded = await expandTarget({
      userId: req.auth.userId,
      targetId: id,
      title: target.title,
      prompt: target.prompt,
      evalInstructions: target.evalInstructions,
      model: pickModel("search_expansion", overrides, body?.model),
    });
    if (expanded.length === 0) return [];

    const platformSearches = toPlatformSearches(expanded);
    const inserted = await db
      .insert(searches)
      .values(
        platformSearches.map((s) => ({
          userId: req.auth.userId,
          targetId: id,
          platform: s.platform,
          query: s.query,
          filters: s.filters as SearchFilters,
          searchUrl: s.searchUrl,
          source: "llm" as const,
        }))
      )
      .returning();
    return inserted.map(serializeSearch);
  });
};
