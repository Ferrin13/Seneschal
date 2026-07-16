import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { comps, itemObservations, listings } from "../../db/schema.js";
import { craigslistComps, craigslistConfigured } from "./craigslist.js";
import { ebayComps, ebayConfigured, type RawComp } from "./ebay.js";

export { ebayConfigured } from "./ebay.js";
export { craigslistConfigured } from "./craigslist.js";

export function anyCompSourceConfigured(): boolean {
  return ebayConfigured() || craigslistConfigured();
}

export type CompsRun = {
  listings: number;
  comps: number;
  errors: number;
};

function normalizeTitle(title: string | null): string | null {
  if (!title) return null;
  return title.toLowerCase().replace(/\s+/g, " ").trim() || null;
}

async function persistComps(
  userId: string,
  listingId: string,
  source: "ebay" | "craigslist",
  raw: RawComp[]
): Promise<number> {
  if (raw.length === 0) return 0;
  await db.insert(comps).values(
    raw.map((c) => ({
      userId,
      listingId,
      source,
      matchedTitle: c.matchedTitle,
      priceCents: c.priceCents,
      currency: c.currency,
      url: c.url,
      soldAt: c.soldAt,
      raw: c.raw,
    }))
  );
  // Dedupe within this batch by normalized title so a single insert never
  // conflicts with itself under the unique index (which would abort the
  // upsert); the last price for a given title wins.
  const byTitle = new Map<
    string,
    {
      userId: string;
      normalizedTitle: string | null;
      priceCents: number | null;
      currency: string | null;
      source: "ebay" | "craigslist";
      listingId: string;
    }
  >();
  for (const c of raw) {
    if (c.priceCents == null) continue;
    const normalizedTitle = normalizeTitle(c.matchedTitle);
    byTitle.set(normalizedTitle ?? `__null__${byTitle.size}`, {
      userId,
      normalizedTitle,
      priceCents: c.priceCents,
      currency: c.currency,
      source,
      listingId,
    });
  }
  for (const obs of byTitle.values()) {
    await db
      .insert(itemObservations)
      .values(obs)
      .onConflictDoUpdate({
        target: [
          itemObservations.userId,
          itemObservations.listingId,
          itemObservations.normalizedTitle,
          itemObservations.source,
        ],
        set: {
          priceCents: obs.priceCents,
          currency: obs.currency,
          observedAt: new Date(),
        },
      });
  }
  return raw.length;
}

/** Gather comps for a single listing from every configured connector. */
export async function gatherCompsForListing(
  userId: string,
  listing: typeof listings.$inferSelect
): Promise<number> {
  const query = listing.title?.trim();
  if (!query) return 0;
  let count = 0;
  if (ebayConfigured()) {
    const raw = await ebayComps(query).catch(() => []);
    count += await persistComps(userId, listing.id, "ebay", raw);
  }
  if (craigslistConfigured()) {
    const raw = await craigslistComps(query).catch(() => []);
    count += await persistComps(userId, listing.id, "craigslist", raw);
  }
  return count;
}

/**
 * Gather comps for listings that don't have any yet. Run this before the
 * advanced evaluator so it has price context.
 */
export async function gatherPendingComps(
  userId: string,
  limit = 20
): Promise<CompsRun> {
  const run: CompsRun = { listings: 0, comps: 0, errors: 0 };

  // Listings for this user that have no comps rows.
  const rows = await db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.userId, userId),
        sql`NOT EXISTS (SELECT 1 FROM ${comps} WHERE ${comps.listingId} = ${listings.id})`
      )
    )
    .orderBy(listings.scrapedAt)
    .limit(limit);

  for (const listing of rows) {
    try {
      run.comps += await gatherCompsForListing(userId, listing);
      run.listings += 1;
    } catch {
      run.errors += 1;
    }
  }
  return run;
}
