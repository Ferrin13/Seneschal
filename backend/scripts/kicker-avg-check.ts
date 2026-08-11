/** One-off: verify K/DEF now price off ESPN/Sharks (no Sleeper drag). */
import { db } from "../src/db/client.js";
import { thrawnLeagues } from "../src/db/schema.js";
import { getLeagueValues } from "../src/thrawn/service.js";

async function main() {
  const [league] = await db.select().from(thrawnLeagues).limit(1);
  if (!league) throw new Error("no thrawn league in DB");
  const snap = await getLeagueValues(league.userId, league.id);

  for (const pos of ["K", "DEF"]) {
    console.log(`\n=== Top 5 ${pos} (source=${league.projectionSource}) ===`);
    const rows = snap.valuation.values
      .filter((v) => v.position === pos)
      .slice(0, 5);
    for (const v of rows) {
      const srcs = Object.entries(v.sourcePoints)
        .map(([s, p]) => `${s}=${p.toFixed(0)}`)
        .join(" ");
      console.log(
        `  ${v.name.padEnd(22)} pts=${v.points.toFixed(0).padStart(4)} ` +
          `ppg=${v.ppg.toFixed(1).padStart(5)} par=${v.par.toFixed(2).padStart(6)} [${srcs}]`
      );
    }
    const repl = snap.valuation.replacement.find((r) => r.position === pos);
    console.log(
      `  replacement: ${pos}${repl?.rank} ${repl?.playerName} ppg=${repl?.ppg}`
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
