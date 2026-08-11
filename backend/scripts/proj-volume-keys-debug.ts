/** One-off: which volume keys does each projection source carry? */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { thrawnLeagues, thrawnPlayers, thrawnProjections } from "../src/db/schema.js";

async function main() {
  const [league] = await db.select().from(thrawnLeagues).limit(1);
  const rows = await db
    .select({
      source: thrawnProjections.source,
      stats: thrawnProjections.stats,
      pos: thrawnPlayers.position,
      first: thrawnPlayers.firstName,
      last: thrawnPlayers.lastName,
    })
    .from(thrawnProjections)
    .innerJoin(thrawnPlayers, eq(thrawnProjections.playerId, thrawnPlayers.id))
    .where(eq(thrawnProjections.season, league!.season));

  for (const name of ["Josh Allen", "Bijan Robinson", "Ja'Marr Chase"]) {
    for (const r of rows) {
      if (`${r.first} ${r.last}` !== name) continue;
      const keys = Object.keys(r.stats as object)
        .filter((k) => /att|tgt|rz|cmp|rec$|^gp|gms/.test(k))
        .sort();
      console.log(`${name} [${r.source}]: ${keys.join(", ") || "(none)"}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
