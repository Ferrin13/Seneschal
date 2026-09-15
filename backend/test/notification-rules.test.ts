import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS,
  sanitizeNotificationPrefs,
  shouldNotify,
  shouldPush,
  type NotificationPrefs,
} from "../src/marketplace/notificationRules.js";

const on: NotificationPrefs = {
  ...DEFAULT_NOTIFICATION_PREFS,
  enabled: true,
  events: { deals: true, sold: true, loginNeeded: true },
};

describe("sanitizeNotificationPrefs", () => {
  it("fills defaults for garbage or empty input", () => {
    expect(sanitizeNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(sanitizeNotificationPrefs("nope")).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("treats rows saved before per-event switches as all-on", () => {
    const legacy = {
      enabled: true,
      minDealScore: 40,
      minValueScore: 70,
      maxPriceCents: 25000,
      targetIds: ["t1"],
    };
    expect(sanitizeNotificationPrefs(legacy).events).toEqual({
      deals: true,
      sold: true,
      loginNeeded: true,
    });
  });

  it("keeps explicit event flags and defaults only the missing ones", () => {
    const prefs = sanitizeNotificationPrefs({
      enabled: true,
      events: { sold: false, loginNeeded: "yes" },
    });
    expect(prefs.events).toEqual({ deals: true, sold: false, loginNeeded: true });
  });

  it("clamps scores, rounds prices, and dedupes targets", () => {
    const prefs = sanitizeNotificationPrefs({
      enabled: "true",
      minDealScore: 150,
      minValueScore: -3,
      maxPriceCents: 1999.6,
      targetIds: ["a", "a", "", 7],
    });
    expect(prefs).toMatchObject({
      enabled: false,
      minDealScore: 100,
      minValueScore: 0,
      maxPriceCents: 2000,
      targetIds: ["a"],
    });
  });
});

describe("shouldNotify", () => {
  it("applies every threshold and the target filter", () => {
    const prefs: NotificationPrefs = {
      ...on,
      minDealScore: 50,
      minValueScore: 60,
      maxPriceCents: 10000,
      targetIds: ["t1"],
    };
    const ok = { valueScore: 70, dealScore: 55, priceCents: 9000, targetId: "t1" };
    expect(shouldNotify(prefs, ok)).toBe(true);
    expect(shouldNotify(prefs, { ...ok, valueScore: 59 })).toBe(false);
    expect(shouldNotify(prefs, { ...ok, dealScore: 49 })).toBe(false);
    expect(shouldNotify(prefs, { ...ok, priceCents: 10001 })).toBe(false);
    expect(shouldNotify(prefs, { ...ok, priceCents: null })).toBe(false);
    expect(shouldNotify(prefs, { ...ok, targetId: "t2" })).toBe(false);
    expect(shouldNotify(prefs, { ...ok, valueScore: null })).toBe(false);
  });

  it("ignores the deal-score gate at 0 and the target filter when empty", () => {
    const prefs: NotificationPrefs = { ...on, minDealScore: 0, targetIds: null };
    expect(
      shouldNotify(prefs, { valueScore: 65, dealScore: null, priceCents: null, targetId: null })
    ).toBe(true);
  });
});

describe("shouldPush", () => {
  it("is off for everything when the master switch is off", () => {
    const prefs = { ...on, enabled: false };
    expect(shouldPush(prefs, "deal")).toBe(false);
    expect(shouldPush(prefs, "sold")).toBe(false);
    expect(shouldPush(prefs, "needs_login")).toBe(false);
  });

  it("honors each per-event switch independently", () => {
    const prefs: NotificationPrefs = {
      ...on,
      events: { deals: true, sold: false, loginNeeded: true },
    };
    expect(shouldPush(prefs, "deal")).toBe(true);
    expect(shouldPush(prefs, "sold")).toBe(false);
    expect(shouldPush(prefs, "needs_login")).toBe(true);

    expect(
      shouldPush({ ...on, events: { deals: false, sold: true, loginNeeded: false } }, "deal")
    ).toBe(false);
  });
});
