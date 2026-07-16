import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { huntRuns, llmCalls } from "../../db/schema.js";
import type { RunMeta } from "../types.js";

/** Outcome counts a run is finalized with. */
export type HuntRunCounts = {
  searches: number;
  discovered: number;
  triaged: number;
  promising: number;
  evaluated: number;
  errors: number;
};

/**
 * Open a hunt-run record when the workflow starts. Idempotent on the Temporal
 * run id (a retried workflow reuses the same row) so counts don't get
 * duplicated. Returns the row id the workflow carries to `finishHuntRun`.
 */
export async function startHuntRun(input: {
  meta: RunMeta;
  targetId: string;
}): Promise<{ huntRunId: string }> {
  const { meta, targetId } = input;
  const [row] = await db
    .insert(huntRuns)
    .values({
      userId: meta.userId,
      targetId,
      workflowId: meta.workflowId,
      runId: meta.runId,
      status: "running",
    })
    .onConflictDoUpdate({
      target: huntRuns.runId,
      set: { status: "running", updatedAt: new Date() },
    })
    .returning({ id: huntRuns.id });
  return { huntRunId: row!.id };
}

/**
 * Finalize a hunt-run record: stamp status/counts, the finish time, and the
 * total LLM cost summed from `mp_llm_calls` tagged with this run's id.
 */
export async function finishHuntRun(input: {
  meta: RunMeta;
  huntRunId: string;
  status: "completed" | "failed";
  counts: HuntRunCounts;
  error?: string | null;
}): Promise<void> {
  const { meta, huntRunId, status, counts, error } = input;
  const now = new Date();

  const [cost] = await db
    .select({ total: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
    .from(llmCalls)
    .where(
      and(eq(llmCalls.userId, meta.userId), eq(llmCalls.runId, meta.runId))
    );

  await db
    .update(huntRuns)
    .set({
      status,
      searches: counts.searches,
      discovered: counts.discovered,
      triaged: counts.triaged,
      promising: counts.promising,
      evaluated: counts.evaluated,
      errors: counts.errors,
      costUsd: cost?.total ?? 0,
      error: error ?? null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(huntRuns.id, huntRunId));
}
