/**
 * Pure helpers for turning a marketplace notification row into the push
 * message the Android app renders. Kept I/O-free so it can be unit tested;
 * `push/fcm.ts` handles delivery.
 *
 * The message is data-only (no FCM `notification` block) on purpose: the
 * phone builds the OS notification itself so a tap can open the web app URL
 * in the browser rather than just launching the Android app.
 */

export type PushMessage = {
  title: string;
  body: string;
  /** FCM data payload — string values only. */
  data: Record<string, string>;
};

export type DealPushInput = {
  /** `mp_notifications.id` */
  notificationId: string;
  /** `deal` | `needs_login` | ... */
  kind: string;
  title: string | null;
  body: string | null;
  /** Candidate the deal belongs to, for a deep link straight to its panel. */
  candidateId?: string | null;
};

/** Longest body we put on the wire; the phone shows it in an expandable style. */
const MAX_BODY = 600;

/**
 * Pick the public web origin from config. Explicit `WEB_APP_URL` wins;
 * otherwise the first https CORS origin, then any CORS origin. Null when
 * nothing is configured (push then sends a link-less notification).
 */
export function resolveWebAppUrl(cfg: {
  WEB_APP_URL?: string | undefined;
  CORS_ORIGINS: readonly string[];
}): string | null {
  const explicit = cfg.WEB_APP_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);
  const https = cfg.CORS_ORIGINS.find((o) => o.startsWith("https://"));
  const pick = https ?? cfg.CORS_ORIGINS[0];
  return pick ? stripTrailingSlash(pick) : null;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Web-app link a notification should open. Deals deep-link to the candidate
 * panel (`/deals/:id`) when we know it, otherwise the deals list; a login-wall
 * alert lands on the deals list too, where the banner explains what to do.
 */
export function dealLink(
  webAppUrl: string,
  kind: string,
  candidateId: string | null | undefined
): string {
  if (kind === "deal" && candidateId) {
    return `${webAppUrl}/deals/${encodeURIComponent(candidateId)}`;
  }
  return `${webAppUrl}/deals`;
}

export function buildDealPush(
  input: DealPushInput,
  webAppUrl: string | null
): PushMessage {
  const title =
    input.title?.trim() ||
    (input.kind === "needs_login" ? "Facebook login needed" : "New deal");
  const body = (input.body ?? "").trim().slice(0, MAX_BODY);
  const data: Record<string, string> = {
    type: "marketplace_notification",
    notificationId: input.notificationId,
    kind: input.kind,
    title,
    body,
  };
  if (input.candidateId) data.candidateId = input.candidateId;
  if (webAppUrl) data.url = dealLink(webAppUrl, input.kind, input.candidateId);
  return { title, body, data };
}
