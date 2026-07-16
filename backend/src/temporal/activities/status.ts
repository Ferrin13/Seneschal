import { db } from "../../db/client.js";
import { browserAgents, notifications } from "../../db/schema.js";
import type { RunMeta } from "../types.js";

/**
 * Flag that the browser box hit a Facebook login wall: mark the agent
 * `needs_login` and raise a notification so the user re-logs in via VNC.
 */
export async function flagNeedsLogin(input: {
  meta: RunMeta;
  agentName?: string;
}): Promise<void> {
  const { meta } = input;
  const name = input.agentName ?? "browser-box";
  const now = new Date();

  await db
    .insert(browserAgents)
    .values({
      userId: meta.userId,
      name,
      status: "needs_login",
      lastSeenAt: now,
      needsLoginSince: now,
    })
    .onConflictDoUpdate({
      target: [browserAgents.userId, browserAgents.name],
      set: {
        status: "needs_login",
        lastSeenAt: now,
        needsLoginSince: now,
        updatedAt: now,
      },
    });

  await db.insert(notifications).values({
    userId: meta.userId,
    kind: "needs_login",
    title: "Facebook login needed",
    body: "The browser box can't reach Marketplace — log in via VNC to refresh the session.",
  });
}
