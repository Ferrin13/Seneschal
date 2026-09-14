/**
 * Pure classifier for per-token FCM send errors: does this failure mean the
 * registration token itself is dead (so its `push_devices` row should go), or
 * is it something else (transient, quota, or a problem with *our* message)?
 *
 * Kept I/O-free so it can be unit tested; `push/fcm.ts` applies it.
 */

/** Codes that unambiguously mean the token is gone for good. */
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/**
 * `messaging/invalid-argument` is overloaded: FCM uses it both for a
 * malformed token *and* for a malformed message (oversized data payload,
 * reserved key, bad TTL...). In the latter case every token in the batch
 * fails with it, and pruning would wipe all of the user's phones over a bug
 * on our side. The Admin SDK's message text tells the two apart.
 */
const TOKEN_MESSAGE = /registration token/i;

export function isDeadTokenError(
  code: string | undefined,
  message: string | undefined
): boolean {
  if (!code) return false;
  if (DEAD_TOKEN_CODES.has(code)) return true;
  if (code === "messaging/invalid-argument") {
    return TOKEN_MESSAGE.test(message ?? "");
  }
  return false;
}
