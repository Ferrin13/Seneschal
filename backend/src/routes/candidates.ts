import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  candidateEvents,
  candidates,
  comps,
  evaluationRatings,
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
    disposition: row.disposition,
    dispositionNote: row.dispositionNote,
    dispositionAt: row.dispositionAt?.toISOString() ?? null,
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
    valueScore: e.valueScore,
    fitScore: e.fitScore,
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

    // Latest advanced + triage evaluations per candidate. Triage rationale is
    // used to backfill a missing triage reason on the card.
    const evalRows = await db
      .select()
      .from(evaluations)
      .where(
        and(
          eq(evaluations.userId, req.auth.userId),
          inArray(evaluations.candidateId, ids)
        )
      )
      .orderBy(desc(evaluations.createdAt));
    const latestEval = new Map<string, EvalRow>();
    const latestTriage = new Map<string, EvalRow>();
    for (const e of evalRows) {
      if (!e.candidateId) continue;
      if (e.tier === "advanced" && !latestEval.has(e.candidateId)) {
        latestEval.set(e.candidateId, e);
      } else if (e.tier === "triage" && !latestTriage.has(e.candidateId)) {
        latestTriage.set(e.candidateId, e);
      }
    }

    // Listing id + comp count per candidate. A candidate can have more than
    // one listing row; prefer the most recently scraped (matches the detail
    // view) and map every listing back to its candidate for the thumbnail.
    const listingRows = await db
      .select({
        id: listings.id,
        candidateId: listings.candidateId,
      })
      .from(listings)
      .where(
        and(
          eq(listings.userId, req.auth.userId),
          inArray(listings.candidateId, ids)
        )
      )
      .orderBy(desc(listings.scrapedAt));
    const listingByCandidate = new Map<string, string>();
    const listingToCandidate = new Map<string, string>();
    for (const l of listingRows) {
      if (!l.candidateId) continue;
      listingToCandidate.set(l.id, l.candidateId);
      if (!listingByCandidate.has(l.candidateId)) {
        listingByCandidate.set(l.candidateId, l.id);
      }
    }
    const listingIds = listingRows.map((l) => l.id);
    const compCounts = new Map<string, number>();
    // First scraped image across any of a candidate's listings — a card
    // thumbnail fallback for platforms (e.g. Craigslist) whose search tiles
    // carry no thumbnail.
    const thumbByCandidate = new Map<string, string>();
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

      const imgs = await db
        .select({
          listingId: listingImages.listingId,
          sourceUrl: listingImages.sourceUrl,
        })
        .from(listingImages)
        .where(inArray(listingImages.listingId, listingIds))
        .orderBy(asc(listingImages.sortOrder));
      for (const im of imgs) {
        const cid = listingToCandidate.get(im.listingId);
        if (cid && im.sourceUrl && !thumbByCandidate.has(cid)) {
          thumbByCandidate.set(cid, im.sourceUrl);
        }
      }
    }

    return rows.map((r) => {
      const e = latestEval.get(r.id);
      const listingId = listingByCandidate.get(r.id) ?? null;
      const base = serializeCandidate(r);
      return {
        ...base,
        thumbnailUrl: base.thumbnailUrl ?? thumbByCandidate.get(r.id) ?? null,
        triageReason: base.triageReason ?? latestTriage.get(r.id)?.rationale ?? null,
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

    const [rating] = await db
      .select()
      .from(evaluationRatings)
      .where(
        and(
          eq(evaluationRatings.candidateId, id),
          eq(evaluationRatings.userId, req.auth.userId)
        )
      )
      .limit(1);

    return {
      candidate: serializeCandidate(candidate),
      listing: listingOut,
      comps: compsOut.map((c) => ({
        id: c.id,
        source: c.source,
        condition: c.condition,
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
      rating: rating
        ? {
            id: rating.id,
            candidateId: rating.candidateId,
            evaluationId: rating.evaluationId,
            fitAccuracy: rating.fitAccuracy,
            fitNote: rating.fitNote,
            valueAccuracy: rating.valueAccuracy,
            valueNote: rating.valueNote,
            createdAt: rating.createdAt.toISOString(),
            updatedAt: rating.updatedAt.toISOString(),
          }
        : null,
    };
  });

  /**
   * Set the user's manual disposition (and optional note) for a candidate.
   * `not_a_fit` and `sold` are terminal — the hunt pipeline stops updating
   * those candidates.
   */
  app.patch("/marketplace/candidates/:id/disposition", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        disposition: z.enum([
          "none",
          "not_a_fit",
          "not_a_good_deal",
          "keep_watching",
          "reached_out",
          "sold",
        ]),
        note: z.string().trim().max(2000).nullish(),
      })
      .parse(req.body);

    const [updated] = await db
      .update(candidates)
      .set({
        disposition: body.disposition,
        dispositionNote: body.note ?? null,
        dispositionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(candidates.id, id), eq(candidates.userId, req.auth.userId))
      )
      .returning();
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return serializeCandidate(updated);
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
