import { desc, eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import {
  candidates,
  huntRuns,
  searchTargets,
  searches,
} from "./schema.js";

const TARGET_ID = "32b9a264-52fa-415e-9dd9-50639f5d6287";

async function main() {
  const [target] = await db
    .select()
    .from(searchTargets)
    .where(eq(searchTargets.id, TARGET_ID))
    .limit(1);
  console.log("TARGET:", target ?? "(not found)");

  if (!target) return;

  const s = await db
    .select()
    .from(searches)
    .where(eq(searches.targetId, TARGET_ID));
  console.log(`\nSEARCHES (${s.length}):`);
  for (const row of s) {
    console.log({
      id: row.id,
      platform: row.platform,
      isActive: row.isActive,
      deletedAt: row.deletedAt,
      hasUrl: !!row.searchUrl,
      searchUrl: row.searchUrl?.slice(0, 80),
    });
  }

  const runs = await db
    .select()
    .from(huntRuns)
    .where(eq(huntRuns.targetId, TARGET_ID))
    .orderBy(desc(huntRuns.startedAt))
    .limit(5);
  console.log(`\nHUNT RUNS (${runs.length}, newest first):`);
  for (const r of runs) {
    console.log({
      status: r.status,
      searches: r.searches,
      discovered: r.discovered,
      triaged: r.triaged,
      promising: r.promising,
      evaluated: r.evaluated,
      errors: r.errors,
      costUsd: r.costUsd,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      error: r.error,
      runId: r.runId,
    });
  }

  const cands = await db
    .select({
      id: candidates.id,
      searchId: candidates.searchId,
      status: candidates.status,
      triageStatus: candidates.triageStatus,
      createdAt: candidates.createdAt,
    })
    .from(candidates)
    .where(eq(candidates.userId, target.userId))
    .orderBy(desc(candidates.createdAt))
    .limit(10);
  console.log(`\nRECENT CANDIDATES for user (${cands.length}):`);
  for (const c of cands) console.log(c);
}

main()
  .catch((e) => console.error("ERROR:", e))
  .finally(() => pool.end());
