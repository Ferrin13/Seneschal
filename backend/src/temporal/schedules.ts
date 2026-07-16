import { ScheduleOverlapPolicy, type ScheduleSpec } from "@temporalio/client";
import { isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { searchTargets } from "../db/schema.js";
import { config } from "../config.js";
import { getTemporalClient } from "./client.js";
import { TASK_QUEUE, huntScheduleId, huntWorkflowId } from "./shared.js";

/** Effective auto-hunt cadence for a target: its override or the server default. */
export function effectiveIntervalMin(huntIntervalMin: number | null): number {
  return huntIntervalMin && huntIntervalMin > 0
    ? huntIntervalMin
    : config.TEMPORAL_HUNT_INTERVAL_MIN;
}

/** The schedule spec (interval + jitter) applied to every hunt schedule. */
function huntSpec(intervalMin: number): ScheduleSpec {
  const spec: ScheduleSpec = {
    intervals: [{ every: `${intervalMin}m` }],
  };
  if (config.TEMPORAL_HUNT_JITTER_MIN > 0) {
    spec.jitter = `${config.TEMPORAL_HUNT_JITTER_MIN}m`;
  }
  return spec;
}

/**
 * Ensure a target's recurring hunt schedule exists and matches the DB: the
 * schedule is created if missing, otherwise reconciled so the cadence, jitter,
 * and paused state always reflect the target. "Paused" (Temporal's native
 * pause) is how an inactive target stops auto-hunting — the schedule is kept
 * around so unpausing is instant and history is preserved. Best-effort on
 * transient failures; the worker re-syncs on boot.
 */
export async function ensureHuntSchedule(input: {
  userId: string;
  targetId: string;
  intervalMin: number;
  paused: boolean;
}): Promise<void> {
  const client = await getTemporalClient();
  const scheduleId = huntScheduleId(input.userId, input.targetId);
  const spec = huntSpec(input.intervalMin);
  try {
    await client.schedule.create({
      scheduleId,
      spec,
      state: {
        paused: input.paused,
        note: input.paused ? "Paused by user" : undefined,
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
    // Already exists: reconcile spec + paused state to match the target.
    const name = (err as { name?: string }).name ?? "";
    const msg = (err as Error).message ?? "";
    if (name === "ScheduleAlreadyRunning" || /already/i.test(msg)) {
      await reconcileHuntSchedule(input).catch(() => undefined);
      return;
    }
    throw err;
  }
}

/** Push the target's current cadence/jitter and paused state onto an existing schedule. */
async function reconcileHuntSchedule(input: {
  userId: string;
  targetId: string;
  intervalMin: number;
  paused: boolean;
}): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.schedule.getHandle(
    huntScheduleId(input.userId, input.targetId)
  );
  const jitterMs =
    config.TEMPORAL_HUNT_JITTER_MIN > 0
      ? config.TEMPORAL_HUNT_JITTER_MIN * 60_000
      : 0;
  await handle.update((prev) => {
    prev.spec.intervals = [{ every: input.intervalMin * 60_000, offset: 0 }];
    prev.spec.calendars = [];
    prev.spec.jitter = jitterMs;
    prev.state.paused = input.paused;
    if (input.paused && !prev.state.note) prev.state.note = "Paused by user";
    return prev;
  });
}

/** Delete a target's hunt schedule (on hard delete). Best-effort. */
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
 * Reconcile schedules with the DB: every non-deleted target gets a schedule,
 * paused iff the target is inactive. Called on backend-worker boot. (Hard
 * deletes remove the schedule at the mutation site.)
 */
export async function syncAllHuntSchedules(): Promise<number> {
  const rows = await db
    .select({
      userId: searchTargets.userId,
      id: searchTargets.id,
      isActive: searchTargets.isActive,
      huntIntervalMin: searchTargets.huntIntervalMin,
    })
    .from(searchTargets)
    .where(isNull(searchTargets.deletedAt));
  for (const r of rows) {
    await ensureHuntSchedule({
      userId: r.userId,
      targetId: r.id,
      intervalMin: effectiveIntervalMin(r.huntIntervalMin),
      paused: !r.isActive,
    }).catch(() => undefined);
  }
  return rows.length;
}
