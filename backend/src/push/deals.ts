import { config } from "../config.js";
import {
  getNotificationPrefs,
  shouldPush,
  type PushEvent,
} from "../marketplace/notificationSettings.js";
import { sendPushToUser } from "./fcm.js";
import { buildDealPush, resolveWebAppUrl, type DealPushInput } from "./payload.js";

/**
 * Push a freshly inserted `mp_notifications` row to the user's phone(s).
 *
 * The thresholds in `notification_prefs` decide whether the row exists at
 * all (see `shouldNotify`); the `enabled` master switch and the per-event
 * switch for `event` decide whether it also goes to the phone (`shouldPush`).
 * Call this *after* the transaction that inserted the row has committed so a
 * tap on the notification finds the data it links to.
 *
 * Best-effort: logs and swallows every failure.
 */
export async function pushDealNotification(
  userId: string,
  event: PushEvent,
  input: DealPushInput
): Promise<void> {
  try {
    const prefs = await getNotificationPrefs(userId);
    if (!shouldPush(prefs, event)) return;
    const message = buildDealPush(input, resolveWebAppUrl(config));
    await sendPushToUser(userId, message);
  } catch (err) {
    console.warn(
      `[push] failed to push notification ${input.notificationId}: ${
        (err as Error).message
      }`
    );
  }
}
