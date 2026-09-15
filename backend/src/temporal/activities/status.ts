import { db } from "../../db/client.js";
import { browserAgents, notifications } from "../../db/schema.js";
import { pushDealNotification } from "../../push/deals.js";
import type { RunMeta } from "../types.js";

/**
 * Flag that the browser box hit a Facebook login wall: mark the agent
 * `needs_login` and raise a notification so the user re-logs in on the local
 * scraping Chrome (the agent drives it over an SSH reverse CDP tunnel; see
 * infra/local/fb-agent-tunnel.ps1).
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

  const [row] = await db
    .insert(notifications)
    .values({
      userId: meta.userId,
      kind: "needs_login",
      title: "Facebook login needed",
      body: "The scraper hit a Facebook login wall — log in to Facebook in the local scraping Chrome (fb-scrape-profile) to refresh the session.",
    })
    .returning({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
    });
  if (row) {
    await pushDealNotification(meta.userId, "needs_login", {
      notificationId: row.id,
      kind: "needs_login",
      title: row.title,
      body: row.body,
    });
  }
}
