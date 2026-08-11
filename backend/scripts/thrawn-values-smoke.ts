/**
 * Live smoke for multi-source projections: force-sync the catalog (Sleeper,
 * ESPN, FantasySharks), then compute the league snapshot under each source
 * and print top players + replacement levels for comparison.
 *
 * Run: npx tsx scripts/thrawn-values-smoke.ts
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { thrawnLeagues } from "../src/db/schema.js";
import {
  ensureCatalog,
  getLeagueValues,
  updateLeague,
} from "../src/thrawn/service.js";

async function main() {
  const [league] = await db.select().from(thrawnLeagues).limit(1);
  if (!league) throw new Error("no thrawn league in DB");
  console.log(
    `league: ${league.name} (${league.season}), source=${league.projectionSource}`
  );

  console.log("force-syncing catalog (all sources)...");
  await ensureCatalog(league.season, true);

  for (const source of ["average", "sleeper", "espn", "sharks"] as const) {
    await updateLeague(league.userId, league.id, { projectionSource: source });
    const snap = await getLeagueValues(league.userId, league.id);
    console.log(`\n=== source: ${source} ===`);
    console.log(`  availableSources: ${snap.availableSources.join(", ")}`);
    console.log(
      `  replacement: ${snap.valuation.replacement
        .map((r) => `${r.position}=${r.ppg.toFixed(1)}`)
        .join(" ")}`
    );
    for (const v of snap.valuation.values.slice(0, 8)) {
      const srcs = Object.entries(v.sourcePoints)
        .map(([s, p]) => `${s}=${p.toFixed(0)}`)
        .join(" ");
      console.log(
        `  ${v.name.padEnd(22)} ${v.position.padEnd(3)} pts=${v.points
          .toFixed(1)
          .padStart(6)} par=${v.par.toFixed(2).padStart(6)} [${srcs}]`
      );
    }
    const k = snap.valuation.values.find((v) => v.position === "K");
    const d = snap.valuation.values.find((v) => v.position === "DEF");
    for (const v of [k, d]) {
      if (!v) continue;
      const srcs = Object.entries(v.sourcePoints)
        .map(([s, p]) => `${s}=${p.toFixed(0)}`)
        .join(" ");
      console.log(
        `  ${v.name.padEnd(22)} ${v.position.padEnd(3)} pts=${v.points
          .toFixed(1)
          .padStart(6)} par=${v.par.toFixed(2).padStart(6)} [${srcs}]`
      );
    }
  }

  // Leave the league on the average of all sources.
  await updateLeague(league.userId, league.id, { projectionSource: "average" });
  console.log("\nleft league on source=average");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
