import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  candidates,
  searchTargets,
  searches,
  userSettings,
} from "../db/schema.js";
import {
  DEFAULT_NOTIFICATION_PREFS,
  sanitizeNotificationPrefs,
  type NotificationPrefs,
} from "./notificationRules.js";

// The pure rules (defaults, coercion, gates) live in notificationRules.ts so
// they can be unit tested; re-exported here so callers have one import.
export {
  DEFAULT_NOTIFICATION_PREFS,
  sanitizeNotificationPrefs,
  shouldNotify,
  shouldPush,
  type NotificationPrefs,
  type PushEvent,
} from "./notificationRules.js";

/** A user's saved notification preferences (defaults when unset). */
export async function getNotificationPrefs(
  userId: string
): Promise<NotificationPrefs> {
  const [row] = await db
    .select({ prefs: userSettings.notificationPrefs })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return row?.prefs
    ? sanitizeNotificationPrefs(row.prefs)
    : { ...DEFAULT_NOTIFICATION_PREFS };
}

/** The target a candidate belongs to (via its search), or null. */
export async function candidateTargetId(
  candidateId: string | null
): Promise<string | null> {
  if (!candidateId) return null;
  const [row] = await db
    .select({ targetId: searches.targetId })
    .from(candidates)
    .innerJoin(searches, eq(candidates.searchId, searches.id))
    .innerJoin(searchTargets, eq(searches.targetId, searchTargets.id))
    .where(eq(candidates.id, candidateId))
    .limit(1);
  return row?.targetId ?? null;
}
