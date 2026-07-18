import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  candidates,
  searchTargets,
  searches,
  userSettings,
  type NotificationPrefs,
} from "../db/schema.js";

export type { NotificationPrefs };

/**
 * Default notification preferences for a user who hasn't configured any. Browser
 * notifications are off until the user explicitly opts in (which also triggers
 * the browser permission prompt), and the value threshold mirrors the legacy
 * "good deal" cutoff so behavior is unchanged out of the box.
 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: false,
  minDealScore: 0,
  minValueScore: 65,
  maxPriceCents: null,
  targetIds: null,
};

function clamp0100(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Coerce arbitrary stored/request JSON into a valid {@link NotificationPrefs}. */
export function sanitizeNotificationPrefs(raw: unknown): NotificationPrefs {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const maxPriceCentsRaw = src.maxPriceCents;
  const maxPriceCents =
    typeof maxPriceCentsRaw === "number" && Number.isFinite(maxPriceCentsRaw)
      ? Math.max(0, Math.round(maxPriceCentsRaw))
      : null;

  const targetIds = Array.isArray(src.targetIds)
    ? [
        ...new Set(
          src.targetIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0
          )
        ),
      ]
    : null;

  return {
    enabled: src.enabled === true,
    minDealScore: clamp0100(src.minDealScore, DEFAULT_NOTIFICATION_PREFS.minDealScore),
    minValueScore: clamp0100(
      src.minValueScore,
      DEFAULT_NOTIFICATION_PREFS.minValueScore
    ),
    maxPriceCents,
    targetIds: targetIds && targetIds.length > 0 ? targetIds : null,
  };
}

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

/**
 * Whether an evaluated candidate clears the user's notification thresholds and
 * target selection, and therefore warrants a deal notification.
 */
export function shouldNotify(
  prefs: NotificationPrefs,
  args: {
    valueScore: number | null;
    dealScore: number | null;
    priceCents: number | null;
    targetId: string | null;
  }
): boolean {
  const { valueScore, dealScore, priceCents, targetId } = args;

  if (valueScore == null || valueScore < prefs.minValueScore) return false;
  if (prefs.minDealScore > 0 && (dealScore ?? 0) < prefs.minDealScore) {
    return false;
  }
  if (prefs.maxPriceCents != null) {
    if (priceCents == null || priceCents > prefs.maxPriceCents) return false;
  }
  if (prefs.targetIds && prefs.targetIds.length > 0) {
    if (!targetId || !prefs.targetIds.includes(targetId)) return false;
  }
  return true;
}
