import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../config.js";

/**
 * Scripture text for the Descartes belief graph.
 *
 * Public-domain translations are fetched by the browser straight from
 * bible-api.com. Copyrighted translations need a licensed API with a secret
 * key, so those go through here. Currently only the ESV (Crossway,
 * https://api.esv.org/) is wired up; the key is free for non-commercial use
 * but must not be exposed to the browser.
 */

const ESV_URL = "https://api.esv.org/v3/passage/text/";

interface EsvResponse {
  canonical?: string;
  passages?: string[];
}

interface Passage {
  reference: string;
  text: string;
  translation: "esv";
}

// Crossway allows 5,000 requests/day; a small in-process cache keeps repeat
// look-ups (the same verse cited on several beliefs) from eating into it.
const CACHE_MAX = 2000;
const cache = new Map<string, Passage | null>();

function remember(key: string, value: Passage | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/** Turn the ESV's "[3] text [4] text" into "3 text 4 text" on one line. */
function tidy(raw: string): string {
  return raw
    .replace(/\[(\d+)\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchEsv(q: string, apiKey: string): Promise<Passage | null> {
  const params = new URLSearchParams({
    q,
    "include-headings": "false",
    "include-footnotes": "false",
    "include-verse-numbers": "true",
    "include-first-verse-numbers": "false",
    "include-short-copyright": "false",
    "include-passage-references": "false",
    "include-selahs": "true",
    "indent-poetry": "false",
    "indent-paragraphs": "0",
    "indent-declares": "0",
    "indent-psalm-doxology": "0",
    "include-passage-horizontal-lines": "false",
    "include-heading-horizontal-lines": "false",
  });
  const res = await fetch(`${ESV_URL}?${params.toString()}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`ESV API responded ${res.status}`);
  }
  const body = (await res.json()) as EsvResponse;
  const text = (body.passages ?? []).map(tidy).filter(Boolean).join(" ");
  if (!body.canonical || !text) return null;
  return { reference: body.canonical, text, translation: "esv" };
}

const passageQuery = z.object({
  q: z.string().trim().min(1).max(200),
  translation: z.literal("esv").default("esv"),
});

export const bibleRoutes: FastifyPluginAsync = async (app) => {
  /** Which server-side translations are available in this deployment. */
  app.get("/bible/translations", async () => {
    return { translations: config.ESV_API_KEY ? ["esv"] : [] };
  });

  app.get("/bible/passage", async (req, reply) => {
    const { q } = passageQuery.parse(req.query);
    const apiKey = config.ESV_API_KEY;
    if (!apiKey) {
      return reply
        .code(503)
        .send({ error: "ESV is not configured on this server (ESV_API_KEY)" });
    }

    const key = q.toLowerCase().replace(/\s+/g, " ");
    let hit = cache.get(key);
    if (hit === undefined) {
      try {
        hit = await fetchEsv(q, apiKey);
      } catch (err) {
        req.log.warn({ err, q }, "esv lookup failed");
        return reply.code(502).send({ error: "ESV lookup failed" });
      }
      remember(key, hit);
    }
    if (hit === null) {
      return reply.code(404).send({ error: "No passage found for this citation" });
    }
    return hit;
  });
};
