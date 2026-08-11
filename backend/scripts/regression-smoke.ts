/**
 * Live smoke for the regression/progression analysis: run the service
 * function against the first league and print both ends of the list.
 *
 * Run: npx tsx scripts/regression-smoke.ts
 */
import { db } from "../src/db/client.js";
import { thrawnLeagues } from "../src/db/schema.js";
import { getLeagueRegression } from "../src/thrawn/service.js";

async function main() {
  const [league] = await db.select().from(thrawnLeagues).limit(1);
  if (!league) throw new Error("no thrawn league in DB");
  const report = await getLeagueRegression(league.userId, league.id);
  console.log(
    `season=${report.season} available=${report.availableSeasons.join(",")} rows=${report.rows.length}`
  );

  const show = (r: (typeof report.rows)[number]) => {
    const phases = r.phases
      .map(
        (p) =>
          `${p.phase}: ${p.actualTd}td/${p.expTd}exp ${p.actualYd}yd/${p.expYd}exp` +
          (p.actualRec != null ? ` ${p.actualRec}rec/${p.expRec}exp` : "")
      )
      .join(" | ");
    console.log(
      `  ${r.name.padEnd(24)} ${r.position.padEnd(3)} gp=${String(r.gp).padStart(2)} ` +
        `luck/g=${r.deltaPtsPerGame.toFixed(2).padStart(6)}  ${phases}`
    );
  };

  console.log("\n=== Regression candidates (overperformed volume) ===");
  for (const r of report.rows.slice(0, 12)) show(r);
  console.log("\n=== Progression candidates (underperformed volume) ===");
  for (const r of report.rows.slice(-12).reverse()) show(r);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
