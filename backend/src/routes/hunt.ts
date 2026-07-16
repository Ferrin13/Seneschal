import type { FastifyPluginAsync } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { searchTargets } from "../db/schema.js";
import { getTemporalClient } from "../temporal/client.js";
import { TASK_QUEUE, huntWorkflowId } from "../temporal/shared.js";

async function loadOwnedTarget(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(searchTargets)
    .where(
      and(
        eq(searchTargets.id, id),
        eq(searchTargets.userId, userId),
        isNull(searchTargets.deletedAt)
      )
    )
    .limit(1);
  if (!row) {
    const err = new Error("target_not_found") as Error & {
      statusCode: number;
    };
    err.statusCode = 404;
    throw err;
  }
  return row;
}

/**
 * Manual hunt trigger: kick off the Temporal `huntTargetWorkflow` for a target
 * right now. Uses a stable per-target workflow id so a target only hunts once
 * at a time (a second trigger while one is running is a no-op / conflict).
 */
export const huntRoutes: FastifyPluginAsync = async (app) => {
  app.post("/marketplace/targets/:id/hunt", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ model: z.string().min(1).max(200).optional() })
      .optional()
      .parse(req.body ?? {});
    const target = await loadOwnedTarget(req.auth.userId, id);

    const client = await getTemporalClient();
    const workflowId = huntWorkflowId(req.auth.userId, target.id);
    try {
      const handle = await client.workflow.start("huntTargetWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [
          { userId: req.auth.userId, targetId: target.id, model: body?.model },
        ],
      });
      return { started: true, workflowId, runId: handle.firstExecutionRunId };
    } catch (err) {
      // Already-running workflow with this id -> report as in-progress.
      if ((err as { name?: string }).name === "WorkflowExecutionAlreadyStartedError") {
        return reply
          .code(409)
          .send({ started: false, workflowId, error: "already_running" });
      }
      throw err;
    }
  });
};
