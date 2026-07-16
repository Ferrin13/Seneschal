import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { comps, itemObservations, listings } from "../../db/schema.js";
import { llmConfigured } from "../../llm/index.js";
import { webComps } from "../../marketplace/comps/web.js";
import { getModelOverrides, pickModel } from "../../marketplace/modelSettings.js";
import type { RunMeta } from "../types.js";
import { logEvent } from "./util.js";

/** Longest meaningful word in a title, for naive internal-comp matching. */
function keyword(title: string | null | undefined): string | null {
  if (!title) return null;
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  if (words.length === 0) return null;
  return words.sort((a, b) => b.length - a.length)[0]!;
}

/**
 * Gather comparables for a scraped listing: an internet search via the LLM's
 * web-search tool (stored as `web` comps) plus similar items from the user's
 * own price history (`internal` comps). Logs a `comps_gathered` event with the
 * count and the model's rough value estimate.
 */
export async function gatherComps(input: {
  meta: RunMeta;
  listingId: string;
  candidateId: string;
}): Promise<{ compCount: number; estimatedValueCents: number | null }> {
  const { meta, listingId, candidateId } = input;

  const [listing] = await db
    .select()
    .from(listings)
    .where(
      and(eq(listings.id, listingId), eq(listings.userId, meta.userId))
    )
    .limit(1);
  if (!listing) return { compCount: 0, estimatedValueCents: null };

  // Clear any stale comps for this listing so re-runs stay idempotent.
  await db.delete(comps).where(eq(comps.listingId, listingId));

  const query = [listing.title, listing.conditionLabel]
    .filter(Boolean)
    .join(" — ");

  let estimatedValueCents: number | null = null;
  let webCount = 0;

  if (query && llmConfigured()) {
    try {
      const overrides = await getModelOverrides(meta.userId);
      const result = await webComps(query, {
        model:
          pickModel("comps", overrides, meta.model) ?? config.LLM_COMPS_MODEL,
        usage: {
          userId: meta.userId,
          purpose: "comps",
          listingId,
          candidateId,
        },
      });
      estimatedValueCents = result.estimatedValueCents;
      if (result.comps.length > 0) {
        await db.insert(comps).values(
          result.comps.map((c) => ({
            userId: meta.userId,
            listingId,
            source: "web" as const,
            matchedTitle: c.matchedTitle,
            priceCents: c.priceCents,
            currency: c.currency,
            url: c.url,
            soldAt: c.soldAt ? new Date(c.soldAt) : null,
            raw: c.raw as Record<string, unknown>,
          }))
        );
        webCount = result.comps.length;
      }
    } catch (err) {
      await logEvent(meta, candidateId, "error", "Web comps failed", {
        error: String(err),
      });
    }
  }

  // Internal comps: similar items from our own observation history.
  let internalCount = 0;
  const kw = keyword(listing.title);
  if (kw) {
    const rows = await db
      .select()
      .from(itemObservations)
      .where(
        and(
          eq(itemObservations.userId, meta.userId),
          ne(itemObservations.listingId, listingId),
          sql`${itemObservations.normalizedTitle} ILIKE ${"%" + kw + "%"}`
        )
      )
      .orderBy(desc(itemObservations.observedAt))
      .limit(10);
    if (rows.length > 0) {
      // Link each internal comp back to the source listing it was observed on
      // so the UI can open the comparable.
      const obsListingIds = [
        ...new Set(
          rows
            .map((o) => o.listingId)
            .filter((id): id is string => id != null)
        ),
      ];
      const urlByListing = new Map<string, string>();
      if (obsListingIds.length > 0) {
        const ls = await db
          .select({ id: listings.id, url: listings.url })
          .from(listings)
          .where(inArray(listings.id, obsListingIds));
        for (const l of ls) urlByListing.set(l.id, l.url);
      }
      await db.insert(comps).values(
        rows.map((o) => ({
          userId: meta.userId,
          listingId,
          source: "internal" as const,
          matchedTitle: o.normalizedTitle,
          priceCents: o.priceCents,
          currency: o.currency,
          url: o.listingId ? urlByListing.get(o.listingId) ?? null : null,
          soldAt: null,
          raw: { observationId: o.id },
        }))
      );
      internalCount = rows.length;
    }
  }

  const compCount = webCount + internalCount;
  await logEvent(meta, candidateId, "comps_gathered", "Gathered comparables", {
    web: webCount,
    internal: internalCount,
    estimatedValueCents,
  });

  return { compCount, estimatedValueCents };
}
