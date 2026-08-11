/**
 * Live smoke for the player detail report: per-season raw stats + luck and
 * current-season projected volume for a couple of well-known players.
 *
 * Run: npx tsx scripts/player-detail-smoke.ts
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { thrawnLeagues, thrawnPlayers } from "../src/db/schema.js";
import { getLeaguePlayerDetail } from "../src/thrawn/service.js";

async function main() {
  const [league] = await db.select().from(thrawnLeagues).limit(1);
  if (!league) throw new Error("no thrawn league in DB");

  for (const [first, last] of [
    ["Josh", "Allen"],
    ["Bijan", "Robinson"],
  ]) {
    const [player] = await db
      .select({ id: thrawnPlayers.id })
      .from(thrawnPlayers)
      .where(eq(thrawnPlayers.lastName, last!))
      .then((rows) => rows.filter(() => true));
    const players = await db
      .select({ id: thrawnPlayers.id, f: thrawnPlayers.firstName })
      .from(thrawnPlayers)
      .where(eq(thrawnPlayers.lastName, last!));
    const match = players.find((p) => p.f === first) ?? player;
    if (!match) {
      console.log(`${first} ${last}: not found`);
      continue;
    }
    const report = await getLeaguePlayerDetail(
      league.userId,
      league.id,
      match.id
    );
    console.log(`\n=== ${first} ${last} (${match.id}) ===`);
    console.log(
      "projected:",
      Object.entries(report.projectedStats)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
    );
    for (const s of report.seasons) {
      console.log(`  ${s.season} gp=${s.gp}`);
      console.log(
        "    stats:",
        Object.entries(s.stats)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")
      );
      if (s.luck) {
        console.log(
          `    luck/g=${s.luck.deltaPtsPerGame} phases=` +
            s.luck.phases
              .map(
                (p) =>
                  `${p.phase}[vol=${p.volume} rz=${p.rzVolume} td=${p.actualTd}/${p.expTd}]`
              )
              .join(" ")
        );
      } else {
        console.log("    luck: below volume minimums");
      }
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
