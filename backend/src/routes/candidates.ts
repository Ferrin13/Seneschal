import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  candidateEvents,
  candidates,
  comps,
  evaluations,
  listingImages,
  listings,
} from "../db/schema.js";
import { llmConfigured } from "../llm/index.js";
import { triagePending } from "../marketplace/triage.js";

type CandidateRow = typeof candidates.$inferSelect;
type EvalRow = typeof evaluations.$inferSelect;
type ListingRow = typeof listings.$inferSelect;

function serializeCandidate(row: CandidateRow) {
  return {
    id: row.id,
    searchId: row.searchId,
    platform: row.platform,
    externalId: row.externalId,
    listingUrl: row.listingUrl,
    title: row.title,
    thumbnailUrl: row.thumbnailUrl,
    priceCents: row.priceCents,
    blurb: row.blurb,
    triageStatus: row.triageStatus,
    triageScore: row.triageScore,
    triageReason: row.triageReason,
    promiseScore: row.promiseScore,
    status: row.status,
    sourceListedAt: row.sourceListedAt?.toISOString() ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeEval(e: EvalRow) {
  return {
    id: e.id,
    tier: e.tier,
    verdict: e.verdict,
    confidence: e.confidence,
    estimatedValueCents: e.estimatedValueCents,
    rationale: e.rationale,
    model: e.model,
    createdAt: e.createdAt.toISOString(),
  };
}

function serializeListing(row: ListingRow, images: (typeof listingImages.$inferSelect)[]) {
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
    isSold: row.isSold,
    listedAt: row.listedAt?.toISOString() ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    disappearedAt: row.disappearedAt?.toISOString() ?? null,
    scrapeStatus: row.scrapeStatus,
    scrapedAt: row.scrapedAt?.toISOString() ?? null,
    images: images.map((i) => ({
      id: i.id,
      url: i.sourceUrl,
      sortOrder: i.sortOrder,
    })),
  };
}

const listQuery = z.object({
  status: z.enum(["active", "sold", "disappeared"]).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});

export const candidateRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Promise-ranked candidate feed: most-promising first (promiseScore desc,
   * nulls last), enriched with the latest advanced evaluation and a listing
   * summary (price + comp count) for the card.
   */
  app.get("/marketplace/candidates", async (req) => {
    const q = listQuery.parse(req.query);
    const filters = [eq(candidates.userId, req.auth.userId)];
    if (q.status) filters.push(eq(candidates.status, q.status));

    const rows = await db
      .select()
      .from(candidates)
      .where(and(...filters))
      .orderBy(
        sql`${candidates.promiseScore} desc nulls last`,
        desc(candidates.lastSeenAt)
      )
      .limit(q.limit);

    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    // Latest advanced evaluation per candidate.
    const evalRows = await db
      .select()
      .from(evaluations)
      .where(
        and(
          eq(evaluations.userId, req.auth.userId),
          eq(evaluations.tier, "advanced"),
          inArray(evaluations.candidateId, ids)
        )
      )
      .orderBy(desc(evaluations.createdAt));
    const latestEval = new Map<string, EvalRow>();
    for (const e of evalRows) {
      if (e.candidateId && !latestEval.has(e.candidateId)) {
        latestEval.set(e.candidateId, e);
      }
    }

    // Listing id + comp count per candidate.
    const listingRows = await db
      .select({ id: listings.id, candidateId: listings.candidateId })
      .from(listings)
      .where(
        and(
          eq(listings.userId, req.auth.userId),
          inArray(listings.candidateId, ids)
        )
      );
    const listingByCandidate = new Map<string, string>();
    for (const l of listingRows) {
      if (l.candidateId) listingByCandidate.set(l.candidateId, l.id);
    }
    const listingIds = listingRows.map((l) => l.id);
    const compCounts = new Map<string, number>();
    if (listingIds.length > 0) {
      const counts = await db
        .select({
          listingId: comps.listingId,
          n: sql<number>`count(*)::int`,
        })
        .from(comps)
        .where(inArray(comps.listingId, listingIds))
        .groupBy(comps.listingId);
      for (const c of counts) compCounts.set(c.listingId, c.n);
    }

    return rows.map((r) => {
      const e = latestEval.get(r.id);
      const listingId = listingByCandidate.get(r.id) ?? null;
      return {
        ...serializeCandidate(r),
        listingId,
        compsCount: listingId ? compCounts.get(listingId) ?? 0 : 0,
        evaluation: e ? serializeEval(e) : null,
      };
    });
  });

  /**
   * Full history for one candidate: the candidate, its scraped listing (with
   * images) + comps, all evaluations, and the append-only event timeline.
   */
  app.get("/marketplace/candidates/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [candidate] = await db
      .select()
      .from(candidates)
      .where(
        and(eq(candidates.id, id), eq(candidates.userId, req.auth.userId))
      )
      .limit(1);
    if (!candidate) return reply.code(404).send({ error: "not_found" });

    const [listing] = await db
      .select()
      .from(listings)
      .where(
        and(
          eq(listings.userId, req.auth.userId),
          eq(listings.candidateId, id)
        )
      )
      .orderBy(desc(listings.scrapedAt))
      .limit(1);

    let listingOut: ReturnType<typeof serializeListing> | null = null;
    let compsOut: (typeof comps.$inferSelect)[] = [];
    if (listing) {
      const imgs = await db
        .select()
        .from(listingImages)
        .where(eq(listingImages.listingId, listing.id))
        .orderBy(asc(listingImages.sortOrder));
      listingOut = serializeListing(listing, imgs);
      compsOut = await db
        .select()
        .from(comps)
        .where(eq(comps.listingId, listing.id))
        .orderBy(asc(comps.priceCents));
    }

    const evals = await db
      .select()
      .from(evaluations)
      .where(
        and(
          eq(evaluations.userId, req.auth.userId),
          eq(evaluations.candidateId, id)
        )
      )
      .orderBy(desc(evaluations.createdAt));

    const events = await db
      .select()
      .from(candidateEvents)
      .where(
        and(
          eq(candidateEvents.userId, req.auth.userId),
          eq(candidateEvents.candidateId, id)
        )
      )
      .orderBy(asc(candidateEvents.createdAt));

    return {
      candidate: serializeCandidate(candidate),
      listing: listingOut,
      comps: compsOut.map((c) => ({
        id: c.id,
        source: c.source,
        matchedTitle: c.matchedTitle,
        priceCents: c.priceCents,
        currency: c.currency,
        url: c.url,
        soldAt: c.soldAt?.toISOString() ?? null,
      })),
      evaluations: evals.map(serializeEval),
      events: events.map((ev) => ({
        id: ev.id,
        stage: ev.stage,
        message: ev.message,
        detail: ev.detail,
        createdAt: ev.createdAt.toISOString(),
      })),
    };
  });

  /**
   * Manual/legacy cheap-LLM triage over pending candidates (the Temporal hunt
   * workflow does this automatically). Requires the LLM (else 503).
   */
  app.post("/marketplace/triage", async (req, reply) => {
    if (!llmConfigured()) {
      return reply.code(503).send({ error: "llm_not_configured" });
    }
    const body = z
      .object({
        limit: z.number().int().positive().max(200).optional(),
        model: z.string().min(1).max(200).optional(),
      })
      .optional()
      .parse(req.body);
    return triagePending(req.auth.userId, body?.limit ?? 50, body?.model);
  });
};
