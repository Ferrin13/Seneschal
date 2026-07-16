import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { comps, evaluations, listingImages, listings } from "../db/schema.js";
import { llmConfigured } from "../llm/index.js";
import { evaluatePending } from "../marketplace/evaluate.js";
import { presignGet } from "../marketplace/storage.js";
import {
  anyCompSourceConfigured,
  gatherPendingComps,
} from "../marketplace/comps/index.js";

async function imagesFor(listingId: string) {
  const rows = await db
    .select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .orderBy(listingImages.sortOrder);
  return Promise.all(
    rows.map(async (img) => ({
      id: img.id,
      url: img.imageKey
        ? ((await presignGet(img.imageKey).catch(() => null)) ?? img.sourceUrl)
        : img.sourceUrl,
      sortOrder: img.sortOrder,
    }))
  );
}

function serialize(
  row: typeof listings.$inferSelect,
  images: { id: string; url: string | null; sortOrder: number }[]
) {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.externalId,
    url: row.url,
    title: row.title,
    description: row.description,
    priceCents: row.priceCents,
    currency: row.currency,
    conditionLabel: row.conditionLabel,
    locationText: row.locationText,
    sellerName: row.sellerName,
    scrapeStatus: row.scrapeStatus,
    scrapedAt: row.scrapedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    images,
  };
}

export const listingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/marketplace/listings", async (req) => {
    const q = z
      .object({ limit: z.coerce.number().int().positive().max(200).default(50) })
      .parse(req.query);
    const rows = await db
      .select()
      .from(listings)
      .where(eq(listings.userId, req.auth.userId))
      .orderBy(desc(listings.scrapedAt))
      .limit(q.limit);

    const ids = rows.map((r) => r.id);

    // Latest advanced evaluation per listing (rows are newest-first).
    const evalRows = ids.length
      ? await db
          .select()
          .from(evaluations)
          .where(
            and(
              eq(evaluations.userId, req.auth.userId),
              eq(evaluations.tier, "advanced"),
              inArray(evaluations.listingId, ids)
            )
          )
          .orderBy(desc(evaluations.createdAt))
      : [];
    const evalByListing = new Map<string, (typeof evalRows)[number]>();
    for (const e of evalRows) {
      if (e.listingId && !evalByListing.has(e.listingId)) {
        evalByListing.set(e.listingId, e);
      }
    }

    // Comp counts per listing.
    const compCounts = ids.length
      ? await db
          .select({
            listingId: comps.listingId,
            count: sql<number>`count(*)::int`,
          })
          .from(comps)
          .where(inArray(comps.listingId, ids))
          .groupBy(comps.listingId)
      : [];
    const compsByListing = new Map(
      compCounts.map((c) => [c.listingId, c.count])
    );

    return Promise.all(
      rows.map(async (r) => {
        const e = evalByListing.get(r.id);
        return {
          ...serialize(r, await imagesFor(r.id)),
          compsCount: compsByListing.get(r.id) ?? 0,
          evaluation: e
            ? {
                verdict: e.verdict,
                valueScore: e.valueScore,
                fitScore: e.fitScore,
                confidence: e.confidence,
                estimatedValueCents: e.estimatedValueCents,
                rationale: e.rationale,
                model: e.model,
                createdAt: e.createdAt.toISOString(),
              }
            : null,
        };
      })
    );
  });

  app.get("/marketplace/listings/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [row] = await db
      .select()
      .from(listings)
      .where(and(eq(listings.id, id), eq(listings.userId, req.auth.userId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "listing_not_found" });

    const evals = await db
      .select()
      .from(evaluations)
      .where(eq(evaluations.listingId, id))
      .orderBy(desc(evaluations.createdAt));
    const compRows = await db
      .select()
      .from(comps)
      .where(eq(comps.listingId, id));

    return {
      ...serialize(row, await imagesFor(id)),
      description: row.description,
      evaluations: evals.map((e) => ({
        id: e.id,
        tier: e.tier,
        model: e.model,
        verdict: e.verdict,
        valueScore: e.valueScore,
        fitScore: e.fitScore,
        confidence: e.confidence,
        estimatedValueCents: e.estimatedValueCents,
        rationale: e.rationale,
        createdAt: e.createdAt.toISOString(),
      })),
      comps: compRows.map((c) => ({
        id: c.id,
        source: c.source,
        condition: c.condition,
        matchedTitle: c.matchedTitle,
        priceCents: c.priceCents,
        url: c.url,
      })),
    };
  });

  /** Gather price comps (eBay/Craigslist) for listings that lack them. */
  app.post("/marketplace/comps", async (req, reply) => {
    if (!anyCompSourceConfigured()) {
      return reply.code(503).send({ error: "no_comp_source_configured" });
    }
    const body = z
      .object({ limit: z.number().int().positive().max(100).optional() })
      .optional()
      .parse(req.body);
    return gatherPendingComps(req.auth.userId, body?.limit ?? 20);
  });

  /** Run advanced-LLM evaluation over listings that lack one. */
  app.post("/marketplace/evaluate", async (req, reply) => {
    if (!llmConfigured()) {
      return reply.code(503).send({ error: "llm_not_configured" });
    }
    const body = z
      .object({
        limit: z.number().int().positive().max(100).optional(),
        model: z.string().min(1).max(200).optional(),
      })
      .optional()
      .parse(req.body);
    return evaluatePending(req.auth.userId, body?.limit ?? 20, body?.model);
  });
};
