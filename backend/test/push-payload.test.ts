import { describe, expect, it } from "vitest";
import {
  buildDealPush,
  dealLink,
  resolveWebAppUrl,
} from "../src/push/payload.js";

describe("resolveWebAppUrl", () => {
  it("prefers the explicit WEB_APP_URL and strips trailing slashes", () => {
    expect(
      resolveWebAppUrl({
        WEB_APP_URL: "https://app.example.com/",
        CORS_ORIGINS: ["http://localhost:15173"],
      })
    ).toBe("https://app.example.com");
  });

  it("falls back to the first https CORS origin, then any origin", () => {
    expect(
      resolveWebAppUrl({
        CORS_ORIGINS: ["http://localhost:15173", "https://app.example.com"],
      })
    ).toBe("https://app.example.com");
    expect(resolveWebAppUrl({ CORS_ORIGINS: ["http://localhost:15173"] })).toBe(
      "http://localhost:15173"
    );
  });

  it("returns null when nothing is configured", () => {
    expect(resolveWebAppUrl({ CORS_ORIGINS: [] })).toBeNull();
    expect(resolveWebAppUrl({ WEB_APP_URL: "  ", CORS_ORIGINS: [] })).toBeNull();
  });
});

describe("dealLink", () => {
  it("deep-links deals to their candidate panel", () => {
    expect(dealLink("https://x.test", "deal", "cand-1")).toBe(
      "https://x.test/deals/cand-1"
    );
  });

  it("lands on the deals list without a candidate or for other kinds", () => {
    expect(dealLink("https://x.test", "deal", null)).toBe("https://x.test/deals");
    expect(dealLink("https://x.test", "needs_login", "cand-1")).toBe(
      "https://x.test/deals"
    );
  });
});

describe("buildDealPush", () => {
  it("produces a string-only data payload with the web link", () => {
    const msg = buildDealPush(
      {
        notificationId: "n1",
        kind: "deal",
        title: "  Trek bike  ",
        body: "$200 (est. value $500) — great condition",
        candidateId: "c1",
      },
      "https://x.test"
    );
    expect(msg.title).toBe("Trek bike");
    expect(msg.body).toBe("$200 (est. value $500) — great condition");
    expect(msg.data).toEqual({
      type: "marketplace_notification",
      notificationId: "n1",
      kind: "deal",
      title: "Trek bike",
      body: "$200 (est. value $500) — great condition",
      candidateId: "c1",
      url: "https://x.test/deals/c1",
    });
    for (const v of Object.values(msg.data)) expect(typeof v).toBe("string");
  });

  it("fills in default titles and omits url/candidateId when unknown", () => {
    const deal = buildDealPush(
      { notificationId: "n2", kind: "deal", title: null, body: null },
      null
    );
    expect(deal.title).toBe("New deal");
    expect(deal.body).toBe("");
    expect(deal.data.url).toBeUndefined();
    expect(deal.data.candidateId).toBeUndefined();

    const login = buildDealPush(
      { notificationId: "n3", kind: "needs_login", title: "", body: "x" },
      "https://x.test"
    );
    expect(login.title).toBe("Facebook login needed");
    expect(login.data.url).toBe("https://x.test/deals");
  });

  it("caps the body length", () => {
    const msg = buildDealPush(
      { notificationId: "n4", kind: "deal", title: "t", body: "a".repeat(2000) },
      null
    );
    expect(msg.body.length).toBe(600);
    expect(msg.data.body.length).toBe(600);
  });
});
