/**
 * One-time backfill to repair broken Craigslist comparable links.
 *
 * LLM-sourced ("web") comps frequently cited plausible-looking but dead
 * Craigslist listing URLs — correct host/format, hallucinated posting id + slug
 * (e.g. a "2019 South Seas Spa" comp linking to
 * `sfbay.craigslist.org/nby/for/d/yountville-compact-hot-tub/7924550056.html`,
 * which 404s). The write-time fix rewrites such deep-links to a same-site
 * search URL, but already-stored rows stay broken until the next hunt
 * regenerates them. This corrects them in place now.
 *
 * Idempotent — safe to run repeatedly (search URLs no longer match the
 * listing-permalink pattern, so they're left untouched on a second pass).
 *
 * Run with:  npm run db:backfill:comp-urls
 */
import { and, eq, sql } from "drizzle-orm";
import { repairCraigslistCompUrl } from "../marketplace/craigslist/url.js";
import { db, pool } from "./client.js";
import { comps } from "./schema.js";

async function main() {
  // Only "web" comps carry hallucinated deep-links; scraped/internal URLs are
  // real. Narrow to Craigslist listing permalinks (`/<digits>.html`).
  const rows = await db
    .select({
      id: comps.id,
      url: comps.url,
      matchedTitle: comps.matchedTitle,
    })
    .from(comps)
    .where(
      and(
        eq(comps.source, "web"),
        sql`${comps.url} ~* '://[^/]*craigslist\\.org/.*/[0-9]+\\.html([?#]|$)'`
      )
    );

  let fixed = 0;
  for (const row of rows) {
    const repaired = await repairCraigslistCompUrl(row.url, row.matchedTitle);
    if (repaired && repaired !== row.url) {
      await db.update(comps).set({ url: repaired }).where(eq(comps.id, row.id));
      fixed++;
    }
  }

  console.log(
    `Checked ${rows.length} web Craigslist comp(s); repaired ${fixed} broken link(s).`
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
