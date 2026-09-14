import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { pushDevices } from "../db/schema.js";
import { firebaseMessaging, pushConfigured } from "../auth/firebase.js";
import type { PushMessage } from "./payload.js";
import { isDeadTokenError } from "./tokenErrors.js";

/**
 * Deliver a data-only, high-priority FCM message to every device the user has
 * registered. Never throws: push is best-effort and must not fail the
 * pipeline step that raised the notification. Dead tokens (app uninstalled,
 * token rotated, data cleared) are pruned; anything else is treated as
 * transient and the token is kept.
 *
 * @returns how many devices accepted the message.
 */
export async function sendPushToUser(
  userId: string,
  message: PushMessage
): Promise<number> {
  const devices = await db
    .select({ id: pushDevices.id, token: pushDevices.token })
    .from(pushDevices)
    .where(eq(pushDevices.userId, userId));
  if (devices.length === 0) return 0;

  if (!pushConfigured()) {
    console.warn(
      `[push] ${devices.length} device(s) registered for user ${userId} but no Firebase service-account credentials are configured; skipping`
    );
    return 0;
  }

  try {
    const res = await firebaseMessaging().sendEachForMulticast({
      tokens: devices.map((d) => d.token),
      data: message.data,
      android: {
        priority: "high",
        // Give the phone a while to receive it if it's asleep or offline.
        ttl: 6 * 60 * 60 * 1000,
      },
    });

    const dead: string[] = [];
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code ?? "unknown";
      if (isDeadTokenError(code, r.error?.message)) {
        dead.push(devices[i]!.id);
      } else {
        console.warn(
          `[push] send to device ${devices[i]!.id} failed: ${code} ${
            r.error?.message ?? ""
          }`
        );
      }
    });
    if (dead.length > 0) {
      await db.delete(pushDevices).where(inArray(pushDevices.id, dead));
      console.info(`[push] pruned ${dead.length} dead device token(s)`);
    }
    return res.successCount;
  } catch (err) {
    console.warn(`[push] FCM send failed: ${(err as Error).message}`);
    return 0;
  }
}
