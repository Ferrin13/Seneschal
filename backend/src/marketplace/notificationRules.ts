/**
 * Pure, I/O-free half of the notification preferences: defaults, coercion of
 * stored/request JSON, and the two gates (should a deal become a notification
 * row; should a notification row be pushed to the phone). The DB-backed
 * lookups live in `notificationSettings.ts`, which re-exports everything here.
 */
import type { NotificationPrefs, PushEvent } from "../db/schema.js";

export type { NotificationPrefs, PushEvent };

/**
 * Default notification preferences for a user who hasn't configured any. The
 * thresholds decide which evaluations become `mp_notifications` rows (see
 * `shouldNotify`); `enabled` and `events` decide whether those rows are also
 * pushed to the user's phone(s) via FCM (`push/deals.ts`). Pushing is off
 * until the user opts in, and every event kind is on so opting in gets the
 * whole feed until they trim it. The value threshold mirrors the legacy
 * "good deal" cutoff so behavior is unchanged out of the box.
 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: false,
  minDealScore: 0,
  minValueScore: 65,
  maxPriceCents: null,
  targetIds: null,
  events: { deals: true, sold: true, loginNeeded: true },
};

function clamp0100(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Missing/garbage flags fall back to the default (on) rather than off. */
function flag(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
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

  // Rows saved before per-event switches existed have no `events`; treat
  // them as all-on so upgrading changes nothing.
  const ev = (
    src.events && typeof src.events === "object" ? src.events : {}
  ) as Record<string, unknown>;
  const d = DEFAULT_NOTIFICATION_PREFS.events;

  return {
    enabled: src.enabled === true,
    minDealScore: clamp0100(src.minDealScore, DEFAULT_NOTIFICATION_PREFS.minDealScore),
    minValueScore: clamp0100(
      src.minValueScore,
      DEFAULT_NOTIFICATION_PREFS.minValueScore
    ),
    maxPriceCents,
    targetIds: targetIds && targetIds.length > 0 ? targetIds : null,
    events: {
      deals: flag(ev.deals, d.deals),
      sold: flag(ev.sold, d.sold),
      loginNeeded: flag(ev.loginNeeded, d.loginNeeded),
    },
  };
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

/**
 * Whether a notification of the given kind should be pushed to the user's
 * phone: the master switch must be on and the per-event switch for that
 * kind must be on. Unknown kinds are pushed (fail open) so a new event type
 * isn't silently dropped until someone remembers to add a switch.
 */
export function shouldPush(prefs: NotificationPrefs, event: PushEvent): boolean {
  if (!prefs.enabled) return false;
  switch (event) {
    case "deal":
      return prefs.events.deals;
    case "sold":
      return prefs.events.sold;
    case "needs_login":
      return prefs.events.loginNeeded;
    default:
      return true;
  }
}
