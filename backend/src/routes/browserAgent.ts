import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { browserAgents } from "../db/schema.js";
import {
  summarizeBrowserAgent,
  type BrowserAgentSummary,
  type ProbeFailure,
} from "../marketplace/browserAgentStatus.js";
import { getTemporalClient } from "../temporal/client.js";
import { TASK_QUEUE } from "../temporal/shared.js";
import type { BrowserAgentAction, BrowserProbe } from "../temporal/types.js";

const DEFAULT_AGENT_NAME = "browser-box";

/**
 * Status + control of the tunneled Facebook browser, for the deal hunter's
 * status panel. Every call runs `browserAgentWorkflow` on demand: the backend
 * worker proxies one activity onto the browser-box queue, which the agent on
 * the EC2 box services against the operator's Chrome through the SSH reverse
 * tunnel. No agent polling that queue => schedule-to-start timeout => offline.
 */
export const browserAgentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/marketplace/browser-agent", async (req) =>
    runAction(req.auth.userId, "status")
  );
  app.post("/marketplace/browser-agent/reconnect", async (req) =>
    runAction(req.auth.userId, "reconnect")
  );
  app.post("/marketplace/browser-agent/rebuild-tunnel", async (req) =>
    runAction(req.auth.userId, "rebuild_tunnel")
  );
};

type StatusResponse = {
  action: BrowserAgentAction;
  checkedAt: string;
  summary: BrowserAgentSummary;
  probe: BrowserProbe | null;
  /** From `mp_browser_agents`: when the last login wall was hit, if unresolved. */
  needsLoginSince: string | null;
};

async function runAction(
  userId: string,
  action: BrowserAgentAction
): Promise<StatusResponse> {
  const outcome = await probeViaTemporal(action);
  const summary = summarizeBrowserAgent(
    "probe" in outcome ? { probe: outcome.probe } : { failure: outcome.failure }
  );
  const probe = "probe" in outcome ? outcome.probe : null;
  const name = probe?.agentName ?? DEFAULT_AGENT_NAME;

  const row = await recordAgentState(userId, name, summary, probe);
  return {
    action,
    checkedAt: probe?.checkedAt ?? new Date().toISOString(),
    summary,
    probe,
    needsLoginSince: row?.needsLoginSince?.toISOString() ?? null,
  };
}

async function probeViaTemporal(
  action: BrowserAgentAction
): Promise<{ probe: BrowserProbe } | { failure: ProbeFailure }> {
  let client;
  try {
    client = await getTemporalClient();
  } catch (err) {
    return {
      failure: { kind: "error", message: `Temporal unavailable: ${msg(err)}` },
    };
  }
  try {
    const probe = await client.workflow.execute("browserAgentWorkflow", {
      taskQueue: TASK_QUEUE,
      // Unique per call: these are fire-and-forget probes, not deduped runs.
      workflowId: `browser-agent:${action}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      args: [{ action }],
      // Rebuild waits up to ~30s on the box; leave headroom for scheduling.
      workflowExecutionTimeout: "2 minutes",
    });
    return { probe: probe as BrowserProbe };
  } catch (err) {
    if (isScheduleToStartTimeout(err)) return { failure: { kind: "agent_offline" } };
    return { failure: { kind: "error", message: msg(err) } };
  }
}

/**
 * Walk the failure chain (WorkflowFailedError -> ActivityFailure ->
 * TimeoutFailure) looking for the "no worker ever started it" signal.
 * Duck-typed so we don't depend on @temporalio/common's class identity.
 */
function isScheduleToStartTimeout(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 6; depth++) {
    const t = (cur as { timeoutType?: unknown }).timeoutType;
    if (t === "SCHEDULE_TO_START" || t === "TIMEOUT_TYPE_SCHEDULE_TO_START" || t === 3) {
      return true;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Keep `mp_browser_agents` in step with what we just observed so the login
 * flag raised by the hunt workflow (`flagNeedsLogin`) clears itself once the
 * browser is seen logged in again, and offline/online is recorded.
 */
async function recordAgentState(
  userId: string,
  name: string,
  summary: BrowserAgentSummary,
  probe: BrowserProbe | null
) {
  const now = new Date();
  const status =
    summary.state === "connected"
      ? "online"
      : summary.state === "needs_login"
        ? "needs_login"
        : "offline";
  const seen = probe !== null;

  const [existing] = await db
    .select()
    .from(browserAgents)
    .where(and(eq(browserAgents.userId, userId), eq(browserAgents.name, name)))
    .limit(1);

  const needsLoginSince =
    status === "needs_login"
      ? (existing?.needsLoginSince ?? now)
      : status === "online"
        ? null
        : (existing?.needsLoginSince ?? null);

  const [row] = await db
    .insert(browserAgents)
    .values({
      userId,
      name,
      status,
      lastSeenAt: seen ? now : null,
      needsLoginSince,
      notes: summary.headline,
    })
    .onConflictDoUpdate({
      target: [browserAgents.userId, browserAgents.name],
      set: {
        status,
        ...(seen ? { lastSeenAt: now } : {}),
        needsLoginSince,
        notes: summary.headline,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
