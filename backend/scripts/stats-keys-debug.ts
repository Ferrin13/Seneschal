/** One-off: inspect 2025 stat keys per position. */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { thrawnPlayerStats, thrawnPlayers } from "../src/db/schema.js";

async function main() {
  const rows = await db
    .select({
      stats: thrawnPlayerStats.stats,
      gp: thrawnPlayerStats.gp,
      pos: thrawnPlayers.position,
      first: thrawnPlayers.firstName,
      last: thrawnPlayers.lastName,
    })
    .from(thrawnPlayerStats)
    .innerJoin(thrawnPlayers, eq(thrawnPlayerStats.playerId, thrawnPlayers.id))
    .where(eq(thrawnPlayerStats.season, "2025"));
  console.log(`rows: ${rows.length}`);
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const r = rows
      .filter((x) => x.pos === pos)
      .sort(
        (a, b) =>
          ((b.stats as any).pts_ppr ?? 0) - ((a.stats as any).pts_ppr ?? 0)
      )[0];
    if (!r) continue;
    console.log(`\n=== ${pos}: ${r.first} ${r.last} gp=${r.gp}`);
    const s = r.stats as Record<string, number>;
    const keys = Object.keys(s)
      .filter((k) =>
        /^(pass|rush|rec|fum|off|snp|tm)_|^(rec|gp|gms)/.test(k)
      )
      .sort();
    for (const k of keys) console.log(`  ${k} = ${s[k]}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
