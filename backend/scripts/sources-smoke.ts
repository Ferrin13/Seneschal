/**
 * Smoke test for the ESPN / FantasySharks projection sources: fetches both
 * feeds, matches players against the thrawn_players dictionary, and prints
 * match rates plus a side-by-side points comparison for well-known players.
 *
 * Run: npx tsx scripts/sources-smoke.ts
 */
import { eq, and } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { thrawnPlayers, thrawnProjections } from "../src/db/schema.js";
import { scoreProjection } from "../src/thrawn/engine.js";
import {
  buildPlayerIndex,
  fetchEspnProjections,
  fetchSharksProjections,
  matchPlayerId,
  type ExternalProjection,
} from "../src/thrawn/sources.js";

const SEASON = "2026";

// This league's scoring (10-team keeper league), from Sleeper.
const SCORING: Record<string, number> = {
  sack: 1, fgm_40_49: 4, pass_int: -1, pts_allow_0: 10, pass_2pt: 2,
  st_td: 6, rec_td: 6, fgm_30_39: 3, fgm_50_59: 5, xpmiss: -1, rush_td: 6,
  rec_2pt: 2, st_fum_rec: 1, fgmiss: -1, ff: 1, rec: 1, pts_allow_14_20: 1,
  fgm_0_19: 3, int: 2, def_st_fum_rec: 1, fum_lost: -2, pts_allow_1_6: 7,
  fgm_60p: 6, fgm_20_29: 3, pts_allow_21_27: 0, xpm: 1, rush_2pt: 2,
  fum_rec: 2, def_st_td: 6, def_td: 6, safe: 2, pass_yd: 0.04, blk_kick: 2,
  pass_td: 4, rush_yd: 0.1, fum: 0, pts_allow_28_34: -1, fum_rec_td: 6,
  rec_yd: 0.1, def_st_ff: 1, pts_allow_7_13: 4, pts_allow_35p: -4, st_ff: 1,
};

async function main() {
  const players = await db
    .select({
      id: thrawnPlayers.id,
      firstName: thrawnPlayers.firstName,
      lastName: thrawnPlayers.lastName,
      position: thrawnPlayers.position,
      team: thrawnPlayers.team,
    })
    .from(thrawnPlayers);
  const index = buildPlayerIndex(players);
  const knownIds = new Set(players.map((p) => p.id));
  console.log(`players in dictionary: ${players.length}`);

  const report = (label: string, entries: ExternalProjection[]) => {
    const byPos = new Map<string, { total: number; matched: number }>();
    const unmatched: string[] = [];
    const matchedIds = new Map<string, number>();
    for (const e of entries) {
      const stat = byPos.get(e.position) ?? { total: 0, matched: 0 };
      stat.total++;
      const id =
        e.position === "DEF"
          ? e.team && knownIds.has(e.team)
            ? e.team
            : null
          : matchPlayerId(index, e.name, e.position, e.team);
      if (id) {
        stat.matched++;
        matchedIds.set(id, scoreProjection(e.stats, SCORING));
      } else {
        unmatched.push(`${e.name} (${e.position} ${e.team ?? "FA"})`);
      }
      byPos.set(e.position, stat);
    }
    console.log(`\n=== ${label}: ${entries.length} entries ===`);
    for (const [pos, s] of [...byPos].sort()) {
      console.log(`  ${pos}: ${s.matched}/${s.total} matched`);
    }
    console.log(`  unmatched sample: ${unmatched.slice(0, 12).join("; ")}`);
    return matchedIds;
  };

  const [espn, sharks] = await Promise.all([
    fetchEspnProjections(SEASON),
    fetchSharksProjections(),
  ]);
  const espnPts = report("ESPN", espn);
  const sharksPts = report("FantasySharks", sharks);

  // Compare against the stored Sleeper projections for familiar names.
  const sleeperRows = await db
    .select({
      playerId: thrawnProjections.playerId,
      stats: thrawnProjections.stats,
    })
    .from(thrawnProjections)
    .where(
      and(
        eq(thrawnProjections.season, SEASON),
        eq(thrawnProjections.source, "sleeper")
      )
    );
  const sleeperPts = new Map(
    sleeperRows.map((r) => [r.playerId, scoreProjection(r.stats, SCORING)])
  );
  const nameById = new Map(
    players.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()])
  );

  console.log("\n=== league-scored comparison (sleeper / espn / sharks) ===");
  const interesting = [...sleeperPts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  for (const [id, slp] of interesting) {
    const e = espnPts.get(id);
    const s = sharksPts.get(id);
    console.log(
      `  ${(nameById.get(id) ?? id).padEnd(24)} ${slp.toFixed(1).padStart(7)} ${(e?.toFixed(1) ?? "-").padStart(7)} ${(s?.toFixed(1) ?? "-").padStart(7)}`
    );
  }
  // A kicker and a defense for the bucket mappings.
  for (const want of ["Brandon Aubrey", "DEN"]) {
    const id = [...nameById.entries()].find(([pid, n]) =>
      want === "DEN" ? pid === "DEN" : n === want
    )?.[0];
    if (!id) continue;
    console.log(
      `  ${(nameById.get(id) ?? id).padEnd(24)} ${(sleeperPts.get(id)?.toFixed(1) ?? "-").padStart(7)} ${(espnPts.get(id)?.toFixed(1) ?? "-").padStart(7)} ${(sharksPts.get(id)?.toFixed(1) ?? "-").padStart(7)}`
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
