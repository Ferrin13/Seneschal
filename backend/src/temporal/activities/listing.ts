import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  candidates,
  itemObservations,
  listingImages,
  listings,
} from "../../db/schema.js";
import { craigslistListing } from "../../marketplace/craigslist/listing.js";
import type { DeepListing } from "../../marketplace/types.js";
import type { RunMeta } from "../types.js";
import { logEvent } from "./util.js";

/** Craigslist deep scrape (server-side fetch + parse of the posting page). */
export async function craigslistDeepScrape(input: {
  url: string;
}): Promise<DeepListing> {
  return craigslistListing(input.url);
}

/**
 * Upsert a fully-scraped listing (source-agnostic) plus its images and a
 * price observation. Deduped by (userId, platform, externalId) when an id is
 * known. Logs a `deep_scraped` event.
 */
export async function upsertListing(input: {
  meta: RunMeta;
  candidateId: string;
  deep: DeepListing;
}): Promise<{ listingId: string }> {
  const { meta, candidateId, deep } = input;
  const now = new Date();

  const listingId = await db.transaction(async (tx) => {
    const values = {
      userId: meta.userId,
      candidateId,
      platform: deep.platform,
      externalId: deep.externalId ?? null,
      url: deep.url,
      title: deep.title ?? null,
      description: deep.description ?? null,
      priceCents: deep.priceCents ?? null,
      currency: deep.currency ?? null,
      conditionCode: deep.conditionCode ?? null,
      conditionLabel: deep.conditionLabel ?? null,
      categoryId: deep.categoryId ?? null,
      categoryPath: deep.categoryPath ?? null,
      locationText: deep.locationText ?? null,
      latitude: deep.latitude ?? null,
      longitude: deep.longitude ?? null,
      sellerId: deep.sellerId ?? null,
      sellerName: deep.sellerName ?? null,
      sellerProfileUrl: deep.sellerProfileUrl ?? null,
      sellerRatingAverage: deep.sellerRatingAverage ?? null,
      sellerRatingCount: deep.sellerRatingCount ?? null,
      availabilityStatus: deep.availabilityStatus ?? null,
      isSold: deep.isSold ?? null,
      isPending: deep.isPending ?? null,
      listedAt: deep.listedAt ? new Date(deep.listedAt) : null,
      sourceUpdatedAt: deep.sourceUpdatedAt ? new Date(deep.sourceUpdatedAt) : null,
      rawExtract: (deep.rawExtract ?? null) as Record<string, unknown> | null,
      scrapeStatus: deep.scrapeStatus,
      lastSeenAt: now,
      scrapedAt: now,
      updatedAt: now,
    };

    let row: typeof listings.$inferSelect | undefined;
    if (deep.externalId) {
      [row] = await tx
        .insert(listings)
        .values(values)
        .onConflictDoUpdate({
          target: [listings.userId, listings.platform, listings.externalId],
          set: { ...values },
        })
        .returning();
    } else {
      [row] = await tx.insert(listings).values(values).returning();
    }
    const lid = row!.id;

    await tx.delete(listingImages).where(eq(listingImages.listingId, lid));
    if (deep.images.length > 0) {
      await tx.insert(listingImages).values(
        deep.images.slice(0, 50).map((img, i) => ({
          userId: meta.userId,
          listingId: lid,
          sourceUrl: img.sourceUrl ?? null,
          imageKey: img.imageKey ?? null,
          width: img.width ?? null,
          height: img.height ?? null,
          caption: img.caption ?? null,
          sortOrder: i,
        }))
      );
    }

    if (deep.priceCents != null) {
      await tx.insert(itemObservations).values({
        userId: meta.userId,
        category: deep.categoryPath?.join(" > ") ?? null,
        normalizedTitle: (deep.title ?? "").toLowerCase().trim() || null,
        priceCents: deep.priceCents,
        currency: deep.currency ?? null,
        source: "internal",
        listingId: lid,
      });
    }

    await tx
      .update(candidates)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(
        and(eq(candidates.id, candidateId), eq(candidates.userId, meta.userId))
      );

    return lid;
  });

  await logEvent(meta, candidateId, "deep_scraped", "Opened listing page", {
    listingId,
    priceCents: deep.priceCents,
    images: deep.images.length,
    scrapeStatus: deep.scrapeStatus,
  });

  return { listingId };
}
