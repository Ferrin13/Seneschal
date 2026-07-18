import { useEffect, useRef } from "react";
import { api, type DealNotification } from "./api";

/** How often to poll the backend for fresh deal notifications, in ms. */
const POLL_MS = 45_000;
/** Above this many unseen deals in one poll, show one summary instead of N. */
const SUMMARY_THRESHOLD = 5;

/** Whether the browser exposes the Notification API at all. */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Current OS-notification permission ("default" when unsupported). */
export function notificationPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : "default";
}

/** Prompt the user for OS-notification permission. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Polls the backend for unseen "deal" notifications and raises a browser (OS)
 * notification for each, subject to the user's saved preferences (the backend
 * already gates which deals become notifications; the `enabled` flag and
 * browser permission gate whether we surface them).
 *
 * Server-side `status` is the source of truth for dedupe: once a deal has been
 * surfaced we mark it `seen`, so it never notifies again (across reloads or
 * tabs). A large batch (e.g. an initial backlog) collapses into a single
 * summary notification instead of flooding the user.
 *
 * @param active whether polling should run (e.g. only while signed in).
 * @param onOpen invoked when the user clicks a notification (e.g. to navigate).
 */
export function useDealNotifications(
  active: boolean,
  onOpen?: (n: DealNotification | null) => void
): void {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!active || !notificationsSupported()) return;

    let cancelled = false;

    const fireOne = (n: DealNotification) => {
      const notif = new Notification(n.title ?? "New deal", {
        body: n.body ?? undefined,
        tag: n.id,
      });
      notif.onclick = () => {
        window.focus();
        onOpenRef.current?.(n);
        notif.close();
      };
    };

    const fireSummary = (count: number, sample: string) => {
      const notif = new Notification(`${count} new deals match your searches`, {
        body: sample || undefined,
        tag: "seneschal-deal-summary",
      });
      notif.onclick = () => {
        window.focus();
        onOpenRef.current?.(null);
        notif.close();
      };
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        if (Notification.permission !== "granted") return;
        const prefs = await api.notificationSettings();
        if (cancelled || !prefs.enabled) return;

        const deals = (await api.notifications()).filter(
          (n) => n.kind === "deal" && n.status === "new"
        );
        if (cancelled || deals.length === 0) return;

        if (deals.length > SUMMARY_THRESHOLD) {
          const sample = deals
            .slice(0, 3)
            .map((d) => d.title ?? "Untitled")
            .join(", ");
          fireSummary(deals.length, sample);
        } else {
          for (const n of deals) fireOne(n);
        }

        // Mark surfaced deals as seen so they don't notify again next poll.
        await Promise.all(
          deals.map((n) => api.updateNotification(n.id, "seen").catch(() => {}))
        );
      } catch {
        /* transient failure — try again next tick */
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);
}
