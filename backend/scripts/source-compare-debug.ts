/**
 * One-off: why does Sleeper score lower than ESPN/FantasySharks?
 * Compares scored totals per source by position and dumps per-key point
 * contributions for sample players.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import {
  thrawnLeagues,
  thrawnPlayers,
  thrawnProjections,
} from "../src/db/schema.js";
import { scoreProjection } from "../src/thrawn/engine.js";

async function main() {
  const [league] = await db.select().from(thrawnLeagues).limit(1);
  if (!league) throw new Error("no league");
  const scoring = league.settings.scoring;

  const rows = await db
    .select({
      source: thrawnProjections.source,
      playerId: thrawnProjections.playerId,
      stats: thrawnProjections.stats,
      pos: thrawnPlayers.position,
      first: thrawnPlayers.firstName,
      last: thrawnPlayers.lastName,
    })
    .from(thrawnProjections)
    .innerJoin(thrawnPlayers, eq(thrawnProjections.playerId, thrawnPlayers.id))
    .where(eq(thrawnProjections.season, league.season));

  type Entry = {
    name: string;
    pos: string;
    bySource: Map<string, Record<string, number>>;
  };
  const players = new Map<string, Entry>();
  for (const r of rows) {
    let e = players.get(r.playerId);
    if (!e) {
      e = {
        name: `${r.first} ${r.last}`,
        pos: r.pos ?? "?",
        bySource: new Map(),
      };
      players.set(r.playerId, e);
    }
    e.bySource.set(r.source, r.stats as Record<string, number>);
  }

  // Aggregate: average scored points by position, players in all 3 sources.
  const SOURCES = ["sleeper", "espn", "sharks"];
  console.log("=== Avg scored season total by position (players in all 3) ===");
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
    const complete = [...players.values()].filter(
      (e) => e.pos === pos && SOURCES.every((s) => e.bySource.has(s))
    );
    // Top 30 by mean so fringe players don't dominate.
    const ranked = complete
      .map((e) => {
        const pts = SOURCES.map((s) =>
          scoreProjection(e.bySource.get(s)!, scoring)
        );
        return { e, pts, mean: pts.reduce((a, b) => a + b, 0) / pts.length };
      })
      .sort((a, b) => b.mean - a.mean)
      .slice(0, 30);
    const avg = SOURCES.map(
      (_, i) => ranked.reduce((s, r) => s + r.pts[i]!, 0) / ranked.length
    );
    console.log(
      `${pos.padEnd(4)} n=${ranked.length}  ` +
        SOURCES.map((s, i) => `${s}=${avg[i]!.toFixed(1)}`).join("  ")
    );
  }

  // Per-key contribution for a few well-known players.
  const SAMPLES = ["Brandon Aubrey|K", "Cameron Dicker|K", "Broncos|DEF", "Texans|DEF"];
  for (const sample of SAMPLES) {
    const [name, pos] = sample.split("|");
    const e = [...players.values()].find(
      (x) => x.pos === pos && x.name.includes(name!)
    );
    if (!e) {
      console.log(`\n=== ${sample}: not found`);
      continue;
    }
    console.log(`\n=== ${e.name} (${e.pos}) — points by stat key ===`);
    const keys = new Set<string>();
    for (const s of SOURCES) {
      for (const k of Object.keys(e.bySource.get(s) ?? {})) {
        if (scoring[k]) keys.add(k);
      }
    }
    const header = ["key".padEnd(14), ...SOURCES.map((s) => s.padStart(9))];
    console.log(header.join(" "));
    for (const k of [...keys].sort()) {
      const cells = SOURCES.map((s) => {
        const v = e.bySource.get(s)?.[k];
        return v == null ? "—".padStart(9) : (v * scoring[k]!).toFixed(1).padStart(9);
      });
      console.log(`${k.padEnd(14)} ${cells.join(" ")}`);
    }
    const totals = SOURCES.map((s) => {
      const stats = e.bySource.get(s);
      return stats ? scoreProjection(stats, scoring).toFixed(1) : "—";
    });
    console.log(
      `${"TOTAL".padEnd(14)} ${totals.map((t) => t.padStart(9)).join(" ")}`
    );
    const gp = SOURCES.map((s) => e.bySource.get(s)?.gp ?? "—");
    console.log(`${"gp".padEnd(14)} ${gp.map((g) => String(g).padStart(9)).join(" ")}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
