import * as cheerio from "cheerio";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { candidates, listings, notifications, searches } from "../../db/schema.js";
import { craigslistSearch } from "../../marketplace/craigslist/search.js";
import { CRAIGSLIST_HEADERS } from "../../marketplace/craigslist/url.js";
import type { HarvestedItem } from "../../marketplace/types.js";
import type {
  CandidateRef,
  RunMeta,
  SearchRef,
  VerifyRef,
  VerifyResult,
} from "../types.js";
import { logEvent } from "./util.js";

/** Number of consecutive misses before a listing is considered gone. */
const DISAPPEAR_THRESHOLD = 2;

/**
 * Terminal user dispositions. Candidates in these states are "done" from the
 * user's perspective, so the hunt pipeline stops refreshing them.
 */
export function isFrozenDisposition(d: string | null | undefined): boolean {
  return d === "not_a_fit" || d === "sold";
}

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
 * the miss counter. Each ref carries a `needsTriage` flag (true for new tiles
 * or re-seen tiles whose price/title changed) so the workflow can skip
 * re-triaging unchanged listings. Returns candidate refs + the dedupe keys
 * seen this run.
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
      .select({
        id: candidates.id,
        disposition: candidates.disposition,
        priceCents: candidates.priceCents,
        title: candidates.title,
        triageStatus: candidates.triageStatus,
      })
      .from(candidates)
      .where(
        and(
          eq(candidates.userId, meta.userId),
          eq(candidates.dedupeKey, dedupeKey)
        )
      )
      .limit(1);

    if (existing) {
      // Terminal user dispositions freeze the candidate: don't refresh or
      // re-queue it for triage/evaluation.
      if (isFrozenDisposition(existing.disposition)) continue;
      // Only re-triage when a triage-relevant signal changed. Harvest only
      // overwrites price/title when the new value is non-null, so mirror that
      // here. Also re-triage anything that never got a successful triage.
      const newPrice = it.priceCents ?? null;
      const newTitle = it.title ?? null;
      const priceChanged = newPrice != null && newPrice !== existing.priceCents;
      const titleChanged = newTitle != null && newTitle !== existing.title;
      const neverTriaged = existing.triageStatus === "pending";
      const needsTriage = priceChanged || titleChanged || neverTriaged;
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
        needsTriage,
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
          needsTriage: true,
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
 * Detect vanished candidates: any active candidate for this search not seen in
 * the latest run accrues a miss. Past the threshold, a non-promising listing is
 * marked `disappeared` on the cheap absence heuristic, while a promising one is
 * held back and returned in `toVerify` so the workflow can re-fetch its PDP and
 * confirm it's really gone before calling it sold (avoids false positives from
 * a listing merely aging out of the search window).
 */
export async function reconcileSeen(input: {
  meta: RunMeta;
  searchId: string;
  seenKeys: string[];
}): Promise<{ missed: number; closed: number; toVerify: VerifyRef[] }> {
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
  const toVerify: VerifyRef[] = [];

  for (const c of active) {
    if (seen.has(c.dedupeKey)) continue;
    // Don't track absence for candidates the user has already dispositioned.
    if (isFrozenDisposition(c.disposition)) continue;
    missed += 1;
    const misses = (c.missedRuns ?? 0) + 1;

    if (misses < DISAPPEAR_THRESHOLD) {
      await db
        .update(candidates)
        .set({ missedRuns: misses, updatedAt: now })
        .where(eq(candidates.id, c.id));
      continue;
    }

    const wasPromising =
      c.triageStatus === "promising" || (c.promiseScore ?? 0) >= 60;

    if (wasPromising) {
      // Record the miss but defer the verdict to PDP re-check.
      await db
        .update(candidates)
        .set({ missedRuns: misses, updatedAt: now })
        .where(eq(candidates.id, c.id));
      toVerify.push({
        id: c.id,
        platform: c.platform,
        url: c.listingUrl,
        title: c.title,
        misses,
      });
      continue;
    }

    // Non-promising listings keep the cheap absence heuristic.
    closed += 1;
    await db
      .update(candidates)
      .set({ status: "disappeared", missedRuns: misses, updatedAt: now })
      .where(eq(candidates.id, c.id));
    await db
      .update(listings)
      .set({ disappearedAt: now, isSold: false, updatedAt: now })
      .where(
        and(
          eq(listings.userId, meta.userId),
          eq(listings.candidateId, c.id)
        )
      );
    await logEvent(meta, c.id, "disappeared", "Listing no longer in search results", {
      misses,
    });
  }

  return { missed, closed, toVerify };
}

/**
 * Re-fetch a Craigslist PDP to confirm a vanished listing is truly gone. A
 * deleted/expired post returns 404/410 or shows a removed banner; anything else
 * (still-live page, or a transient/network/blocked error) counts as not gone so
 * we never false-positive a "sold".
 */
export async function verifyCraigslistGone(input: {
  url: string;
}): Promise<VerifyResult> {
  try {
    const res = await fetch(input.url, {
      headers: CRAIGSLIST_HEADERS,
      redirect: "follow",
    });
    if (res.status === 404 || res.status === 410) {
      return { gone: true, reason: `http_${res.status}` };
    }
    if (!res.ok) {
      return { gone: false, reason: `http_${res.status}` };
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    if ($(".removed, .post-expired-note").length > 0) {
      return { gone: true, reason: "removed_banner" };
    }
    if (/this posting has (been deleted|expired)/i.test(html)) {
      return { gone: true, reason: "expired_text" };
    }
    return { gone: false, reason: "still_live" };
  } catch (err) {
    return { gone: false, reason: `error:${(err as Error).message}` };
  }
}

/**
 * Resolve a verified promising candidate. If the PDP re-check confirms it's
 * gone, mark it sold (listing `disappearedAt`/`isSold`, a `sold` event, and a
 * "likely sold" notification). If it's still live it merely fell out of the
 * snapshot (e.g. aged past Facebook's recency window) — reset its miss counter
 * and keep it active.
 */
export async function finalizeDisappearance(input: {
  meta: RunMeta;
  candidate: VerifyRef;
  result: VerifyResult;
}): Promise<{ sold: boolean }> {
  const { meta, candidate, result } = input;
  const now = new Date();

  if (!result.gone) {
    await db
      .update(candidates)
      .set({ missedRuns: 0, status: "active", updatedAt: now })
      .where(eq(candidates.id, candidate.id));
    return { sold: false };
  }

  await db
    .update(candidates)
    .set({ status: "sold", updatedAt: now })
    .where(eq(candidates.id, candidate.id));
  await db
    .update(listings)
    .set({ disappearedAt: now, isSold: true, updatedAt: now })
    .where(
      and(
        eq(listings.userId, meta.userId),
        eq(listings.candidateId, candidate.id)
      )
    );
  await logEvent(
    meta,
    candidate.id,
    "sold",
    "Listing confirmed gone on re-check — likely sold",
    { reason: result.reason, misses: candidate.misses }
  );
  await db.insert(notifications).values({
    userId: meta.userId,
    kind: "deal",
    title: "Likely sold",
    body: `A promising listing ("${candidate.title ?? "untitled"}") is gone on re-check — probably sold.`,
  });
  return { sold: true };
}
