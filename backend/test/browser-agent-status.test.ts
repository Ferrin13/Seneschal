import { describe, expect, it } from "vitest";
import { summarizeBrowserAgent } from "../src/marketplace/browserAgentStatus";
import type { BrowserProbe } from "../src/temporal/types";

const WIN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36";

function probe(over: Partial<BrowserProbe> = {}): BrowserProbe {
  return {
    agentName: "browser-box",
    checkedAt: "2026-09-11T00:00:00.000Z",
    cdp: {
      url: "http://127.0.0.1:9222",
      reachable: true,
      browser: "Chrome/152.0.0.0",
      userAgent: WIN_UA,
      platform: "windows",
      error: null,
    },
    facebookLoggedIn: true,
    tunnel: {
      available: true,
      ipv4Holder: "sshd",
      ipv6Holder: "sshd",
      legacyChromeActive: false,
      error: null,
    },
    ...over,
  };
}

describe("summarizeBrowserAgent", () => {
  it("reports connected when the tunnel is bound and FB is logged in", () => {
    const s = summarizeBrowserAgent({ probe: probe() });
    expect(s.state).toBe("connected");
    expect(s.canReconnect).toBe(true);
  });

  it("flags the legacy on-box Chrome when it holds IPv4 9222", () => {
    const s = summarizeBrowserAgent({
      probe: probe({
        cdp: {
          url: "http://127.0.0.1:9222",
          reachable: true,
          browser: "Chrome/150.0.7871.124",
          userAgent: LINUX_UA,
          platform: "linux",
          error: null,
        },
        facebookLoggedIn: false,
        tunnel: {
          available: true,
          ipv4Holder: "chrome",
          ipv6Holder: "sshd",
          legacyChromeActive: true,
          error: null,
        },
      }),
    });
    expect(s.state).toBe("wrong_browser");
    expect(s.canRebuildTunnel).toBe(true);
    expect(s.canReconnect).toBe(false);
    expect(s.detail).toContain("Linux");
  });

  it("flags wrong_browser from the UA alone when the box helper is unavailable", () => {
    const s = summarizeBrowserAgent({
      probe: probe({
        cdp: {
          url: "http://127.0.0.1:9222",
          reachable: true,
          browser: null,
          userAgent: LINUX_UA,
          platform: "linux",
          error: null,
        },
        tunnel: {
          available: false,
          ipv4Holder: null,
          ipv6Holder: null,
          legacyChromeActive: null,
          error: "ENOENT",
        },
      }),
    });
    expect(s.state).toBe("wrong_browser");
  });

  it("distinguishes 'tunnel bound but Chrome off' from 'nothing listening'", () => {
    const dead = probe({
      cdp: {
        url: "http://127.0.0.1:9222",
        reachable: false,
        browser: null,
        userAgent: null,
        platform: null,
        error: "ECONNREFUSED",
      },
      facebookLoggedIn: null,
    });
    const boundButDead = summarizeBrowserAgent({ probe: dead });
    expect(boundButDead.state).toBe("tunnel_down");
    expect(boundButDead.headline).toMatch(/browser not answering/i);

    const nothing = summarizeBrowserAgent({
      probe: probe({
        ...dead,
        tunnel: {
          available: true,
          ipv4Holder: null,
          ipv6Holder: null,
          legacyChromeActive: false,
          error: null,
        },
      }),
    });
    expect(nothing.state).toBe("tunnel_down");
    expect(nothing.headline).toBe("Tunnel down");
    expect(nothing.detail).toContain("fb-agent-tunnel.ps1");
  });

  it("reports needs_login when reachable but no c_user cookie", () => {
    const s = summarizeBrowserAgent({ probe: probe({ facebookLoggedIn: false }) });
    expect(s.state).toBe("needs_login");
    expect(s.canRebuildTunnel).toBe(false);
  });

  it("prioritizes wrong_browser over needs_login", () => {
    const s = summarizeBrowserAgent({
      probe: probe({
        facebookLoggedIn: false,
        tunnel: {
          available: true,
          ipv4Holder: "chrome",
          ipv6Holder: null,
          legacyChromeActive: true,
          error: null,
        },
      }),
    });
    expect(s.state).toBe("wrong_browser");
  });

  it("maps a missing worker to agent_offline with no actions", () => {
    const s = summarizeBrowserAgent({ failure: { kind: "agent_offline" } });
    expect(s.state).toBe("agent_offline");
    expect(s.canReconnect).toBe(false);
    expect(s.canRebuildTunnel).toBe(false);
  });

  it("surfaces other failures as error with the message", () => {
    const s = summarizeBrowserAgent({
      failure: { kind: "error", message: "temporal unreachable" },
    });
    expect(s.state).toBe("error");
    expect(s.detail).toBe("temporal unreachable");
  });
});
