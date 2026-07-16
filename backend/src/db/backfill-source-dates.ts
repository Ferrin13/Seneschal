/**
 * One-time backfill of candidate source timestamps from their listings.
 *
 * Deep scrape captures a listing's real "posted" (`listedAt`) and "edited"
 * (`sourceUpdatedAt`) times on `mp_listings`, but until recently those were
 * never copied onto `mp_candidates`, whose `source_listed_at` /
 * `source_updated_at` power the deal card's "Posted"/"Updated" labels and the
 * posted-within filter. The pipeline now backfills these at scrape time; this
 * repairs already-scraped candidates in place.
 *
 * For each candidate we take the most recent non-null value across all of its
 * listings (independently per field). Existing candidate values are preserved —
 * we only fill in nulls — so the script is idempotent and safe to re-run.
 *
 * Run with:  npm run db:backfill:source-dates
 */
import { desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db, pool } from "./client.js";
import { candidates, listings } from "./schema.js";

async function main() {
  // Candidates still missing at least one source timestamp.
  const targets = await db
    .select({
      id: candidates.id,
      sourceListedAt: candidates.sourceListedAt,
      sourceUpdatedAt: candidates.sourceUpdatedAt,
    })
    .from(candidates)
    .where(
      or(
        isNull(candidates.sourceListedAt),
        isNull(candidates.sourceUpdatedAt)
      )
    );

  if (targets.length === 0) {
    console.log("No candidates need backfilling.");
    await pool.end();
    return;
  }

  const targetIds = new Set(targets.map((c) => c.id));

  // Pull every listing that carries a date, newest scrape first, so the first
  // non-null value we see per candidate/field is the freshest.
  const listingRows = await db
    .select({
      candidateId: listings.candidateId,
      listedAt: listings.listedAt,
      sourceUpdatedAt: listings.sourceUpdatedAt,
      scrapedAt: listings.scrapedAt,
    })
    .from(listings)
    .where(or(isNotNull(listings.listedAt), isNotNull(listings.sourceUpdatedAt)))
    .orderBy(desc(listings.scrapedAt));

  const best = new Map<
    string,
    { listedAt: Date | null; sourceUpdatedAt: Date | null }
  >();
  for (const l of listingRows) {
    if (!l.candidateId || !targetIds.has(l.candidateId)) continue;
    const cur = best.get(l.candidateId) ?? {
      listedAt: null,
      sourceUpdatedAt: null,
    };
    if (cur.listedAt == null && l.listedAt != null) cur.listedAt = l.listedAt;
    if (cur.sourceUpdatedAt == null && l.sourceUpdatedAt != null)
      cur.sourceUpdatedAt = l.sourceUpdatedAt;
    best.set(l.candidateId, cur);
  }

  let updated = 0;
  for (const c of targets) {
    const src = best.get(c.id);
    if (!src) continue;
    // Only fill nulls; never clobber an existing candidate value.
    const nextListedAt = c.sourceListedAt ?? src.listedAt;
    const nextUpdatedAt = c.sourceUpdatedAt ?? src.sourceUpdatedAt;
    const changed =
      nextListedAt !== c.sourceListedAt || nextUpdatedAt !== c.sourceUpdatedAt;
    if (!changed) continue;
    await db
      .update(candidates)
      .set({
        sourceListedAt: nextListedAt ?? undefined,
        sourceUpdatedAt: nextUpdatedAt ?? undefined,
      })
      .where(eq(candidates.id, c.id));
    updated++;
  }

  console.log(
    `Checked ${targets.length} candidate(s) missing source dates; backfilled ${updated}.`
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
