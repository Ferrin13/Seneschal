/**
 * Smoke for the Team Analysis deep-dive: runs the frontend's analysis
 * helpers (lineup fill, weekly outlook, starter risks) against the live
 * values snapshot for the user's own team.
 *
 * Run: npx tsx scripts/team-analysis-smoke.ts
 */
import { db } from "../src/db/client.js";
import { thrawnLeagues } from "../src/db/schema.js";
import { getLeagueValues } from "../src/thrawn/service.js";
import {
  computeStarterRisks,
  computeWeeklyOutlook,
  fillLineup,
} from "../../frontend/src/thrawn/teamDetail";
import type { PlayerValue } from "../../frontend/src/thrawn/types";

async function main() {
  const [league] = await db.select().from(thrawnLeagues).limit(1);
  if (!league) throw new Error("no thrawn league in DB");
  const snap = await getLeagueValues(league.userId, league.id);
  const rosterId = snap.league.myRosterId ?? snap.teams[0]!.rosterId;
  const team = snap.teams.find((t) => t.rosterId === rosterId)!;
  console.log(`team: ${team.teamName ?? team.displayName} (roster ${rosterId})`);

  const roster = snap.valuation.values.filter(
    (v) => v.rosterId === rosterId
  ) as unknown as PlayerValue[];
  console.log(`roster size: ${roster.length}`);

  const starterIds = fillLineup(
    roster.map((v) => ({ playerId: v.playerId, position: v.position, pts: v.ppg })),
    snap.league.settings.rosterPositions
  ).starterIds;
  console.log(
    `starters: ${roster
      .filter((v) => starterIds.has(v.playerId))
      .map((v) => `${v.position} ${v.name}`)
      .join("; ")}`
  );

  const outlook = computeWeeklyOutlook(
    roster,
    snap.league.settings.rosterPositions,
    starterIds
  );
  console.log("\nweekly outlook:");
  for (const w of outlook) {
    const byes = w.byes.map((v) => v.name).join(", ");
    console.log(
      `  wk ${String(w.week).padStart(2)}: ${w.points.toFixed(1).padStart(6)} pts` +
        (w.starterByes.length > 0 ? `  [${w.starterByes.length} starter byes: ${byes}]` : "") +
        (w.unfilled > 0 ? `  UNFILLED=${w.unfilled}` : "")
    );
  }

  const risks = computeStarterRisks(
    roster,
    starterIds,
    snap.valuation.replacement as never
  ).sort((a, b) => b.expectedLoss - a.expectedLoss);
  console.log("\nstarter risks:");
  for (const r of risks) {
    console.log(
      `  ${r.player.position.padEnd(3)} ${r.player.name.padEnd(24)} ppg=${r.player.ppg
        .toFixed(1)
        .padStart(5)} avgGp=${r.durability.avgGp?.toFixed(1) ?? "  — "} backup=${(
        r.backup?.name ?? "waivers"
      ).padEnd(22)} drop=${r.dropoff.toFixed(1)} expLoss=${r.expectedLoss.toFixed(2)}`
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
