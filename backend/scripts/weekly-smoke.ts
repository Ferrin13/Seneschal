/**
 * Smoke for weekly projections + bye weeks: force a catalog sync, then
 * check that ESPN rows carry weekly arrays and players have bye weeks, and
 * that the values snapshot exposes both for rostered players.
 *
 * Run: npx tsx scripts/weekly-smoke.ts
 */
import { and, eq, isNotNull, count } from "drizzle-orm";
import { db } from "../src/db/client.js";
import {
  thrawnLeagues,
  thrawnPlayers,
  thrawnProjections,
} from "../src/db/schema.js";
import { ensureCatalog, getLeagueValues } from "../src/thrawn/service.js";

async function main() {
  const [league] = await db.select().from(thrawnLeagues).limit(1);
  if (!league) throw new Error("no thrawn league in DB");

  console.log("force-syncing catalog...");
  await ensureCatalog(league.season, true);

  const [weeklyCount] = await db
    .select({ n: count() })
    .from(thrawnProjections)
    .where(
      and(
        eq(thrawnProjections.season, league.season),
        eq(thrawnProjections.source, "espn"),
        isNotNull(thrawnProjections.weekly)
      )
    );
  const [byeCount] = await db
    .select({ n: count() })
    .from(thrawnPlayers)
    .where(isNotNull(thrawnPlayers.byeWeek));
  console.log(`espn rows with weekly: ${weeklyCount?.n}`);
  console.log(`players with bye week: ${byeCount?.n}`);

  const snap = await getLeagueValues(league.userId, league.id);
  const rostered = snap.valuation.values.filter((v) => v.rosterId != null);
  const withWeekly = rostered.filter((v) => v.weekly != null);
  const withBye = rostered.filter((v) => v.byeWeek != null);
  console.log(
    `rostered: ${rostered.length}, weekly: ${withWeekly.length}, bye: ${withBye.length}`
  );
  const sample = withWeekly[0];
  if (sample) {
    console.log(
      `sample: ${sample.name} bye=${sample.byeWeek} weekly=[${sample.weekly!
        .map((w) => w.toFixed(1))
        .join(", ")}]`
    );
  }
  const noWeekly = rostered.filter((v) => v.weekly == null).slice(0, 8);
  console.log(
    `rostered without weekly: ${noWeekly
      .map((v) => `${v.name} (${v.position})`)
      .join("; ")}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
