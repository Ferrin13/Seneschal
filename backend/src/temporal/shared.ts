import { config } from "../config.js";

/**
 * Constants and argument types shared between the Temporal client (which
 * starts workflows), the workflow definitions (sandboxed), and the workers.
 * Keep this module free of Node-only imports so it is safe to import from the
 * workflow bundle.
 */

export const TASK_QUEUE = config.TEMPORAL_TASK_QUEUE;
export const BROWSER_TASK_QUEUE = config.TEMPORAL_BROWSER_TASK_QUEUE;
export const NAMESPACE = config.TEMPORAL_NAMESPACE;

/** Input to the top-level hunt workflow: one run over a single target. */
export type HuntTargetInput = {
  userId: string;
  targetId: string;
  /** Optional per-run model override for the LLM steps (model comparison). */
  model?: string;
};

/** Stable workflow id so a target only hunts once at a time. */
export function huntWorkflowId(userId: string, targetId: string): string {
  return `hunt:${userId}:${targetId}`;
}

/** Schedule id for a target's recurring hunt. */
export function huntScheduleId(userId: string, targetId: string): string {
  return `hunt-schedule:${userId}:${targetId}`;
}
