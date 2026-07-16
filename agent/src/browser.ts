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

/** Error marker for a Facebook login wall, surfaced to the workflow. */
export class LoggedOutError extends Error {
  readonly loggedOut = true;
  constructor() {
    super("logged_out");
    this.name = "LoggedOutError";
  }
}
