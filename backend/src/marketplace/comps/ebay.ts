import { config } from "../../config.js";

/**
 * eBay Browse API connector for price comparables. Uses the application
 * (client-credentials) OAuth flow — no user context needed for public search.
 */

export type RawComp = {
  matchedTitle: string | null;
  priceCents: number | null;
  currency: string | null;
  url: string | null;
  soldAt: Date | null;
  raw: Record<string, unknown>;
};

export function ebayConfigured(): boolean {
  return !!(config.EBAY_CLIENT_ID && config.EBAY_CLIENT_SECRET);
}

function hosts() {
  return config.EBAY_ENV === "sandbox"
    ? { api: "https://api.sandbox.ebay.com" }
    : { api: "https://api.ebay.com" };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function appToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.value;
  }
  const basic = Buffer.from(
    `${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(`${hosts().api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ebay_token_error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

type ItemSummary = {
  title?: string;
  itemWebUrl?: string;
  price?: { value?: string; currency?: string };
};

/** Search active listings on eBay for comparables to `query`. */
export async function ebayComps(query: string, limit = 10): Promise<RawComp[]> {
  if (!ebayConfigured()) return [];
  const token = await appToken();
  const url = new URL(`${hosts().api}/buy/browse/v1/item_summary/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ebay_search_error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { itemSummaries?: ItemSummary[] };
  return (data.itemSummaries ?? []).map((it) => {
    const value = it.price?.value ? Number(it.price.value) : null;
    return {
      matchedTitle: it.title ?? null,
      priceCents: value != null && Number.isFinite(value)
        ? Math.round(value * 100)
        : null,
      currency: it.price?.currency ?? null,
      url: it.itemWebUrl ?? null,
      soldAt: null,
      raw: it as Record<string, unknown>,
    };
  });
}
