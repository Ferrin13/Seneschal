import { chromium, type Browser, type BrowserContext } from "playwright";
import { config } from "./config.js";

/**
 * Lazily-connected, reused CDP connection to the local logged-in Chrome.
 * Activities share one browser/context; if the connection drops we reconnect
 * on the next call. We connect over CDP (never launch) so the human-maintained
 * session/cookies are preserved.
 */
let browser: Browser | null = null;
let context: BrowserContext | null = null;

async function connect(): Promise<BrowserContext> {
  browser = await chromium.connectOverCDP(config.cdpUrl);
  browser.on("disconnected", () => {
    browser = null;
    context = null;
  });
  context = browser.contexts()[0] ?? (await browser.newContext());
  return context;
}

export async function getContext(): Promise<BrowserContext> {
  if (context && browser?.isConnected()) return context;
  return connect();
}

/**
 * Drop the cached CDP connection so the next call reconnects from scratch.
 * Used after the tunnel is rebuilt: Playwright's `disconnected` event doesn't
 * always fire when the far end is swapped out underneath an SSH forward.
 */
export async function resetConnection(): Promise<void> {
  const b = browser;
  browser = null;
  context = null;
  if (b) {
    // `close()` on a connectOverCDP browser only closes our connection; it
    // does not quit the human's Chrome.
    await b.close().catch(() => undefined);
  }
}

/**
 * Cheap logged-in check without navigating: Facebook sets `c_user` (the
 * viewer's user id) for authenticated sessions and clears it on logout.
 */
export async function isFacebookLoggedIn(
  context: BrowserContext
): Promise<boolean> {
  const cookies = await context.cookies("https://www.facebook.com");
  return cookies.some((c) => c.name === "c_user" && c.value !== "");
}

/** Error marker for a Facebook login wall, surfaced to the workflow. */
export class LoggedOutError extends Error {
  readonly loggedOut = true;
  constructor() {
    super("logged_out");
    this.name = "LoggedOutError";
  }
}
