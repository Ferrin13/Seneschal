import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import type { BrowserPlatform, BrowserProbe } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Root helper installed on the agent host by `box/install.sh`. It's the only
 * privileged thing the agent can run (via a narrow sudoers rule): inspect who
 * holds port 9222 and bounce the reverse tunnel. Absent when the agent runs
 * anywhere else (local dev), in which case tunnel info is simply unavailable.
 */
const TUNNEL_CTL = "/usr/local/sbin/seneschal-tunnel-ctl";

/** Classify a browser User-Agent into an OS family. */
export function platformFromUserAgent(ua: string | null): BrowserPlatform | null {
  if (!ua) return null;
  if (/Windows NT/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/X11|Linux/i.test(ua)) return "linux";
  return "unknown";
}

/** Fetch CDP's `/json/version` with a short timeout; never throws. */
export async function probeCdp(
  timeoutMs = 4000
): Promise<BrowserProbe["cdp"]> {
  const url = `${config.cdpUrl.replace(/\/$/, "")}/json/version`;
  const base = {
    url: config.cdpUrl,
    reachable: false,
    browser: null,
    userAgent: null,
    platform: null,
    error: null,
  };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ...base, error: `http_${res.status}` };
    const body = (await res.json()) as {
      Browser?: string;
      "User-Agent"?: string;
    };
    const userAgent = body["User-Agent"] ?? null;
    return {
      ...base,
      reachable: true,
      browser: body.Browser ?? null,
      userAgent,
      platform: platformFromUserAgent(userAgent),
    };
  } catch (err) {
    return { ...base, error: describeError(err) };
  }
}

type TunnelCtlStatus = {
  ipv4: string | null;
  ipv6: string | null;
  legacyChromeActive: boolean;
};

async function runTunnelCtl(
  action: "status" | "rebuild",
  timeoutMs: number
): Promise<TunnelCtlStatus> {
  const { stdout } = await execFileAsync(
    "sudo",
    ["-n", TUNNEL_CTL, action],
    { timeout: timeoutMs }
  );
  return JSON.parse(stdout) as TunnelCtlStatus;
}

function toTunnelInfo(
  result: PromiseSettledResult<TunnelCtlStatus>
): BrowserProbe["tunnel"] {
  if (result.status === "fulfilled") {
    return {
      available: true,
      ipv4Holder: result.value.ipv4,
      ipv6Holder: result.value.ipv6,
      legacyChromeActive: result.value.legacyChromeActive,
      error: null,
    };
  }
  return {
    available: false,
    ipv4Holder: null,
    ipv6Holder: null,
    legacyChromeActive: null,
    error: describeError(result.reason),
  };
}

/** Ask the root helper who holds port 9222 on the box; never throws. */
export async function tunnelStatus(): Promise<BrowserProbe["tunnel"]> {
  const [r] = await Promise.allSettled([runTunnelCtl("status", 10_000)]);
  return toTunnelInfo(r!);
}

/**
 * Ask the root helper to rebuild the tunnel path: stop any legacy on-box
 * Chrome squatting on 9222, drop the current reverse-forward SSH session so
 * the operator's keep-alive script reconnects (and rebinds IPv4), and wait for
 * a fresh listener. Never throws; the caller re-probes CDP afterwards.
 */
export async function rebuildTunnel(): Promise<BrowserProbe["tunnel"]> {
  const [r] = await Promise.allSettled([runTunnelCtl("rebuild", 60_000)]);
  return toTunnelInfo(r!);
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code) return cause.code;
    if (err.name === "TimeoutError") return "timeout";
    return err.message;
  }
  return String(err);
}
