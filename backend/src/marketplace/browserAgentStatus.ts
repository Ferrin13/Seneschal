import type { BrowserProbe } from "../temporal/types.js";

/**
 * Pure interpretation of a tunneled-browser probe for the deal hunter's status
 * panel. No I/O: the route feeds in the agent's probe (or the reason it
 * couldn't get one) and this decides what the operator is looking at and what
 * to do about it.
 *
 * The path being judged, end to end:
 *   operator's Chrome (logged into Facebook)
 *     <- SSH reverse tunnel (box 127.0.0.1:9222 -> local CDP)
 *     <- scraper agent on the EC2 box (Temporal worker, browser-box queue)
 *     <- backend
 */

export type BrowserAgentState =
  | "connected" // everything healthy: agent up, tunnel bound, FB logged in
  | "needs_login" // browser reachable but no Facebook session cookie
  | "wrong_browser" // a non-operator (legacy on-box) Chrome holds port 9222
  | "tunnel_down" // agent up but nothing answers CDP: tunnel / local Chrome off
  | "agent_offline" // no worker picked up the probe: box or agent down
  | "error"; // probe failed for another reason

export type BrowserAgentSummary = {
  state: BrowserAgentState;
  /** One-line headline for the status chip. */
  headline: string;
  /** What's going on and what fixes it, for the panel body. */
  detail: string;
  /** Whether "Reconnect" (drop + redial CDP) is a sensible action right now. */
  canReconnect: boolean;
  /** Whether "Rebuild tunnel" (root helper on the box) is a sensible action. */
  canRebuildTunnel: boolean;
};

/** Why the route has no probe to summarize. */
export type ProbeFailure =
  | { kind: "agent_offline" }
  | { kind: "error"; message: string };

const OPERATOR_HINT =
  "On the operator machine, make sure the dedicated scraping Chrome is running " +
  "and infra/local/fb-agent-tunnel.ps1 is keeping the SSH tunnel up.";

export function summarizeBrowserAgent(
  input: { probe: BrowserProbe } | { failure: ProbeFailure }
): BrowserAgentSummary {
  if ("failure" in input) {
    if (input.failure.kind === "agent_offline") {
      return {
        state: "agent_offline",
        headline: "Scraper agent offline",
        detail:
          "No worker picked up the probe on the browser task queue. The agent " +
          "host is down or scraper-agent isn't running; check the EC2 box " +
          "(systemctl status scraper-agent). Nothing can be fixed from here " +
          "until it's back.",
        canReconnect: false,
        canRebuildTunnel: false,
      };
    }
    return {
      state: "error",
      headline: "Status check failed",
      detail: input.failure.message,
      canReconnect: true,
      canRebuildTunnel: true,
    };
  }

  const { probe } = input;
  const { cdp, tunnel } = probe;

  // A Linux Chrome answering CDP, or the box helper seeing "chrome" on the
  // IPv4 socket, means the legacy on-box browser is squatting on the port and
  // the agent is talking to the wrong browser (it has no Facebook session and
  // is wired to a dead SOCKS proxy). Rebuild kills it and rebinds the tunnel.
  const wrongBrowser =
    tunnel.ipv4Holder === "chrome" ||
    tunnel.legacyChromeActive === true ||
    (cdp.reachable && cdp.platform === "linux");
  if (wrongBrowser) {
    return {
      state: "wrong_browser",
      headline: "Wrong browser on port 9222",
      detail:
        "A legacy Chrome on the agent host is holding 127.0.0.1:9222, so the " +
        "agent isn't reaching the operator's browser through the tunnel" +
        (cdp.userAgent ? ` (saw: ${cdp.userAgent})` : "") +
        ". Use Rebuild tunnel to stop it and rebind the tunnel.",
      canReconnect: false,
      canRebuildTunnel: true,
    };
  }

  if (!cdp.reachable) {
    const boundButDead = tunnel.ipv4Holder === "sshd";
    return {
      state: "tunnel_down",
      headline: boundButDead ? "Tunnel bound, browser not answering" : "Tunnel down",
      detail: boundButDead
        ? "The SSH tunnel is connected but the operator's Chrome isn't " +
          "answering on its CDP port" +
          (cdp.error ? ` (${cdp.error})` : "") +
          ". Start the dedicated scraping Chrome on the operator machine, " +
          "then Reconnect."
        : "Nothing is listening on the agent host's port 9222" +
          (cdp.error ? ` (${cdp.error})` : "") +
          ". " +
          OPERATOR_HINT +
          " Rebuild tunnel forces the keep-alive script to reconnect if it's running.",
      canReconnect: true,
      canRebuildTunnel: true,
    };
  }

  if (probe.facebookLoggedIn === false) {
    return {
      state: "needs_login",
      headline: "Facebook login needed",
      detail:
        "The tunneled browser is reachable but has no Facebook session. Log in " +
        "to Facebook in the scraping Chrome profile (fb-scrape-profile) on the " +
        "operator machine, then re-check.",
      canReconnect: true,
      canRebuildTunnel: false,
    };
  }

  return {
    state: "connected",
    headline: "Connected",
    detail:
      "The agent is reaching the operator's browser through the tunnel" +
      (cdp.browser ? ` (${cdp.browser})` : "") +
      (probe.facebookLoggedIn === null
        ? "; couldn't confirm the Facebook session."
        : " and it's logged into Facebook."),
    canReconnect: true,
    canRebuildTunnel: true,
  };
}
