/**
 * One-time backfill to correct duplicated comparable data.
 *
 * Historically, every deep-scrape appended a fresh `mp_item_observations` row
 * for a listing (and each comp-connector run appended one per match), so a
 * single item accumulated many identical observations. Those duplicates then
 * fanned out into `mp_comps`, showing the same internal comparable several
 * times on a deal.
 *
 * This script collapses both tables in place, keeping one representative row
 * per logical item. It is idempotent — safe to run repeatedly. The write-time
 * fix (unique index + upsert) prevents new duplicates going forward.
 *
 * Run with:  npm run db:backfill:observations
 */
import { sql } from "drizzle-orm";
import { db, pool } from "./client.js";

async function main() {
  // 1. Collapse duplicate observations, keeping the most recent per
  //    (user, listing, title, source). Mirrors migration 0015 so this works
  //    whether or not the unique index has been applied yet.
  const obs = await db.execute(sql`
    WITH ranked AS (
      SELECT id, row_number() OVER (
        PARTITION BY "user_id", "listing_id", "normalized_title", "source"
        ORDER BY "observed_at" DESC, "id" DESC
      ) AS rn
      FROM "mp_item_observations"
      WHERE "listing_id" IS NOT NULL AND "normalized_title" IS NOT NULL
    )
    DELETE FROM "mp_item_observations" a
    USING ranked d
    WHERE a."id" = d.id AND d.rn > 1
  `);
  console.log(`Removed ${obs.rowCount ?? 0} duplicate observation row(s).`);

  // 2. Collapse duplicate comps so already-materialized comparable lists are
  //    corrected immediately (they'd otherwise stay duplicated until the next
  //    hunt regenerates them). Keeps the earliest row per logical comp.
  const dupComps = await db.execute(sql`
    WITH ranked AS (
      SELECT id, row_number() OVER (
        PARTITION BY
          "listing_id", "source", "matched_title", "price_cents", COALESCE("url", '')
        ORDER BY "created_at" ASC, "id" ASC
      ) AS rn
      FROM "mp_comps"
    )
    DELETE FROM "mp_comps" a
    USING ranked d
    WHERE a."id" = d.id AND d.rn > 1
  `);
  console.log(`Removed ${dupComps.rowCount ?? 0} duplicate comp row(s).`);

  console.log("Backfill complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
