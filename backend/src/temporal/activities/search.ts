import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { candidates, listings, notifications, searches } from "../../db/schema.js";
import { craigslistSearch } from "../../marketplace/craigslist/search.js";
import type { HarvestedItem } from "../../marketplace/types.js";
import type { CandidateRef, RunMeta, SearchRef } from "../types.js";
import { logEvent } from "./util.js";

/** Number of consecutive misses before a listing is considered gone. */
const DISAPPEAR_THRESHOLD = 2;

/** Active, non-deleted searches for a target. */
export async function getActiveSearches(input: {
  userId: string;
  targetId: string;
}): Promise<SearchRef[]> {
  const rows = await db
    .select()
    .from(searches)
    .where(
      and(
        eq(searches.userId, input.userId),
        eq(searches.targetId, input.targetId),
        eq(searches.isActive, true),
        isNull(searches.deletedAt)
      )
    );
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    query: r.query,
    searchUrl: r.searchUrl,
  }));
}

/** Craigslist search harvest (server-side fetch + parse). */
export async function craigslistHarvestSearch(input: {
  searchUrl: string;
}): Promise<HarvestedItem[]> {
  return craigslistSearch(input.searchUrl);
}

/**
 * Upsert harvested tiles into candidates, stamping seen timestamps. New tiles
 * get a `discovered` event; re-seen tiles just refresh `lastSeenAt` and reset
 * the miss counter. Returns candidate refs + the dedupe keys seen this run.
 */
export async function upsertHarvest(input: {
  meta: RunMeta;
  searchId: string;
  items: HarvestedItem[];
}): Promise<{ candidates: CandidateRef[]; seenKeys: string[] }> {
  const { meta, searchId, items } = input;
  const now = new Date();
  const refs: CandidateRef[] = [];
  const seenKeys: string[] = [];

  for (const it of items) {
    const dedupeKey = it.externalId ?? it.url;
    seenKeys.push(dedupeKey);
    const listedAt = it.listedAt ? new Date(it.listedAt) : null;

    const [existing] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(
          eq(candidates.userId, meta.userId),
          eq(candidates.dedupeKey, dedupeKey)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(candidates)
        .set({
          lastSeenAt: now,
          missedRuns: 0,
          status: "active",
          priceCents: it.priceCents ?? undefined,
          title: it.title ?? undefined,
          updatedAt: now,
        })
        .where(eq(candidates.id, existing.id));
      refs.push({
        id: existing.id,
        platform: it.platform,
        url: it.url,
        externalId: it.externalId,
      });
    } else {
      const [row] = await db
        .insert(candidates)
        .values({
          userId: meta.userId,
          searchId,
          platform: it.platform,
          externalId: it.externalId,
          listingUrl: it.url,
          title: it.title ?? null,
          thumbnailUrl: it.thumbnailUrl ?? null,
          priceCents: it.priceCents ?? null,
          dedupeKey,
          sourceListedAt: listedAt,
          firstSeenAt: now,
          lastSeenAt: now,
          status: "active",
        })
        .onConflictDoNothing({
          target: [candidates.userId, candidates.dedupeKey],
        })
        .returning({ id: candidates.id });
      const id = row?.id;
      if (id) {
        refs.push({
          id,
          platform: it.platform,
          url: it.url,
          externalId: it.externalId,
        });
        await logEvent(meta, id, "discovered", `Found on ${it.platform}`, {
          searchId,
          title: it.title,
          priceCents: it.priceCents,
          url: it.url,
        });
      }
    }
  }

  return { candidates: refs, seenKeys };
}

/**
 * Detect sold/disappeared candidates: any active candidate for this search not
 * seen in the latest run accrues a miss; past the threshold it's marked sold
 * (if it was promising) or disappeared, its listing gets `disappearedAt`, and a
 * notification is raised for good deals that vanished.
 */
export async function reconcileSeen(input: {
  meta: RunMeta;
  searchId: string;
  seenKeys: string[];
}): Promise<{ missed: number; closed: number }> {
  const { meta, searchId, seenKeys } = input;
  const now = new Date();

  const active = await db
    .select()
    .from(candidates)
    .where(
      and(
        eq(candidates.userId, meta.userId),
        eq(candidates.searchId, searchId),
        eq(candidates.status, "active"),
        isNull(candidates.deletedAt)
      )
    );

  const seen = new Set(seenKeys);
  let missed = 0;
  let closed = 0;

  for (const c of active) {
    if (seen.has(c.dedupeKey)) continue;
    missed += 1;
    const misses = (c.missedRuns ?? 0) + 1;

    if (misses < DISAPPEAR_THRESHOLD) {
      await db
        .update(candidates)
        .set({ missedRuns: misses, updatedAt: now })
        .where(eq(candidates.id, c.id));
      continue;
    }

    // Promising items that vanish are most likely sold.
    const wasPromising =
      c.triageStatus === "promising" || (c.promiseScore ?? 0) >= 60;
    const status = wasPromising ? "sold" : "disappeared";
    closed += 1;

    await db
      .update(candidates)
      .set({ status, missedRuns: misses, updatedAt: now })
      .where(eq(candidates.id, c.id));

    await db
      .update(listings)
      .set({ disappearedAt: now, isSold: status === "sold", updatedAt: now })
      .where(
        and(
          eq(listings.userId, meta.userId),
          eq(listings.candidateId, c.id)
        )
      );

    await logEvent(
      meta,
      c.id,
      status === "sold" ? "sold" : "disappeared",
      status === "sold"
        ? "Promising listing disappeared — likely sold"
        : "Listing no longer in search results",
      { misses }
    );

    if (wasPromising) {
      await db.insert(notifications).values({
        userId: meta.userId,
        kind: "deal",
        title: "Likely sold",
        body: `A promising listing ("${c.title ?? "untitled"}") disappeared from search — probably sold.`,
      });
    }
  }

  return { missed, closed };
}
