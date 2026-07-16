import { ScheduleOverlapPolicy } from "@temporalio/client";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { searchTargets } from "../db/schema.js";
import { config } from "../config.js";
import { getTemporalClient } from "./client.js";
import { TASK_QUEUE, huntScheduleId, huntWorkflowId } from "./shared.js";

/**
 * Ensure a recurring hunt schedule exists for a target. Idempotent: if the
 * schedule already exists it's left as-is. Overlap is SKIP so a slow run never
 * stacks up behind the interval.
 */
export async function ensureHuntSchedule(input: {
  userId: string;
  targetId: string;
}): Promise<void> {
  const client = await getTemporalClient();
  const scheduleId = huntScheduleId(input.userId, input.targetId);
  try {
    await client.schedule.create({
      scheduleId,
      spec: {
        intervals: [{ every: `${config.TEMPORAL_HUNT_INTERVAL_MIN}m` }],
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
      action: {
        type: "startWorkflow",
        workflowType: "huntTargetWorkflow",
        taskQueue: TASK_QUEUE,
        workflowId: huntWorkflowId(input.userId, input.targetId),
        args: [{ userId: input.userId, targetId: input.targetId }],
      },
    });
  } catch (err) {
    // Already exists is fine; rethrow anything else.
    if ((err as { name?: string }).name !== "ScheduleAlreadyRunning") {
      const name = (err as Error).message ?? "";
      if (!/already/i.test(name)) throw err;
    }
  }
}

/** Delete a target's hunt schedule (on deactivate/delete). Best-effort. */
export async function removeHuntSchedule(input: {
  userId: string;
  targetId: string;
}): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.schedule.getHandle(
    huntScheduleId(input.userId, input.targetId)
  );
  await handle.delete().catch(() => undefined);
}

/**
 * Reconcile schedules with the DB: create schedules for every active target.
 * Called on backend-worker boot. (Deletion is handled at the mutation site.)
 */
export async function syncAllHuntSchedules(): Promise<number> {
  const rows = await db
    .select({ userId: searchTargets.userId, id: searchTargets.id })
    .from(searchTargets)
    .where(
      and(eq(searchTargets.isActive, true), isNull(searchTargets.deletedAt))
    );
  for (const r of rows) {
    await ensureHuntSchedule({ userId: r.userId, targetId: r.id }).catch(
      () => undefined
    );
  }
  return rows.length;
}
