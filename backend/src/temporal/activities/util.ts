import { db } from "../../db/client.js";
import { candidateEvents } from "../../db/schema.js";
import type { RunMeta } from "../types.js";

export type Stage =
  | "discovered"
  | "triaged"
  | "deep_scraped"
  | "comps_gathered"
  | "evaluated"
  | "sold"
  | "disappeared"
  | "error";

/** Append a candidate history event (best-effort; never throws). */
export async function logEvent(
  meta: RunMeta,
  candidateId: string,
  stage: Stage,
  message: string | null,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insert(candidateEvents).values({
      userId: meta.userId,
      candidateId,
      stage,
      message,
      detail: (detail ?? null) as Record<string, unknown> | null,
      workflowId: meta.workflowId,
      runId: meta.runId,
    });
  } catch {
    /* logging must not break the pipeline */
  }
}
