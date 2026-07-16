import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { searches } from "../db/schema.js";
import {
  buildFbSearchUrl,
  type SearchFilters,
} from "../marketplace/searchExpansion.js";
import { buildCraigslistSearchUrl } from "../marketplace/craigslist/url.js";
import type { Platform } from "../marketplace/types.js";

/** Build the ready-to-open search URL for a platform. */
function searchUrlFor(
  platform: Platform,
  query: string,
  filters: SearchFilters
): string | null {
  return platform === "craigslist"
    ? buildCraigslistSearchUrl(query, filters)
    : buildFbSearchUrl(query, filters);
}

const filtersSchema = z
  .object({
    minPriceCents: z.number().int().nonnegative().optional(),
    maxPriceCents: z.number().int().nonnegative().optional(),
    category: z.string().max(200).optional(),
    radiusMiles: z.number().positive().optional(),
    condition: z.array(z.string().max(100)).optional(),
  })
  .strict();

const createBody = z.object({
  targetId: z.string().uuid(),
  platform: z.enum(["facebook", "craigslist"]).default("facebook"),
  query: z.string().min(1).max(400),
  filters: filtersSchema.optional(),
});

const updateBody = z.object({
  query: z.string().min(1).max(400).optional(),
  filters: filtersSchema.optional(),
  isActive: z.boolean().optional(),
});

function serialize(row: typeof searches.$inferSelect) {
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

async function loadOwned(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(searches)
    .where(
      and(
        eq(searches.id, id),
        eq(searches.userId, userId),
        isNull(searches.deletedAt)
      )
    )
    .limit(1);
  if (!row) {
    const err = new Error("search_not_found") as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  return row;
}

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get("/marketplace/searches", async (req) => {
    const rows = await db
      .select()
      .from(searches)
      .where(
        and(eq(searches.userId, req.auth.userId), isNull(searches.deletedAt))
      )
      .orderBy(desc(searches.createdAt));
    return rows.map(serialize);
  });

  app.post("/marketplace/searches", async (req) => {
    const body = createBody.parse(req.body);
    const filters = (body.filters ?? {}) as SearchFilters;
    const [row] = await db
      .insert(searches)
      .values({
        userId: req.auth.userId,
        targetId: body.targetId,
        platform: body.platform,
        query: body.query,
        filters,
        searchUrl: searchUrlFor(body.platform, body.query, filters),
        source: "user",
      })
      .returning();
    return serialize(row!);
  });

  app.patch("/marketplace/searches/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await loadOwned(req.auth.userId, id);

    const nextQuery = body.query ?? existing.query;
    const nextFilters = (body.filters ??
      (existing.filters as SearchFilters | null) ??
      {}) as SearchFilters;
    const urlChanged = body.query !== undefined || body.filters !== undefined;

    const [row] = await db
      .update(searches)
      .set({
        ...(body.query !== undefined ? { query: body.query } : {}),
        ...(body.filters !== undefined ? { filters: nextFilters } : {}),
        ...(urlChanged
          ? {
              searchUrl: searchUrlFor(
                existing.platform,
                nextQuery,
                nextFilters
              ),
            }
          : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(searches.id, id))
      .returning();
    return serialize(row!);
  });

  app.delete("/marketplace/searches/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await loadOwned(req.auth.userId, id);
    await db
      .update(searches)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(searches.id, id));
    return { ok: true };
  });
};
