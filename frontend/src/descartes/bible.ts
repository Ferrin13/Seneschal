/**
 * Scripture text lookup for references.
 *
 * Public-domain translations come from bible-api.com (free, no key) straight
 * from the browser. The ESV is copyrighted and Crossway's API key must stay
 * server-side, so it is fetched via the Seneschal backend (GET /bible/passage)
 * and only offered when the server reports it configured.
 *
 * Requests are serialised through a small queue and cached per
 * (translation, reference) for the session so re-opening a belief never
 * re-fetches.
 */

import { ApiError, api } from "../api";

export type TranslationId =
  | "esv"
  | "web"
  | "kjv"
  | "asv"
  | "ylt"
  | "darby"
  | "bbe";

export interface TranslationMeta {
  id: TranslationId;
  label: string;
  name: string;
  /** Where the text comes from. */
  source: "bible-api" | "server";
  /** Required attribution, shown wherever this translation's text appears. */
  copyright?: string;
}

export const TRANSLATIONS: TranslationMeta[] = [
  {
    id: "esv",
    label: "ESV",
    name: "English Standard Version",
    source: "server",
    copyright:
      "Scripture quotations marked ESV are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.",
  },
  { id: "web", label: "WEB", name: "World English Bible", source: "bible-api" },
  { id: "kjv", label: "KJV", name: "King James Version", source: "bible-api" },
  { id: "asv", label: "ASV", name: "American Standard Version", source: "bible-api" },
  { id: "ylt", label: "YLT", name: "Young's Literal Translation", source: "bible-api" },
  { id: "darby", label: "Darby", name: "Darby Translation", source: "bible-api" },
  { id: "bbe", label: "BBE", name: "Bible in Basic English", source: "bible-api" },
];

export function translationMeta(id: string | undefined): TranslationMeta | undefined {
  return TRANSLATIONS.find((t) => t.id === id);
}

/**
 * Server-side translations available in this deployment. Resolved once per
 * session; falls back to none if the user isn't signed in or the request fails.
 */
let serverTranslations: Promise<Set<TranslationId>> | null = null;
export function availableTranslations(): Promise<TranslationMeta[]> {
  serverTranslations ??= api
    .bibleTranslations()
    .then((r) => new Set(r.translations as TranslationId[]))
    .catch(() => {
      serverTranslations = null; // let a later call retry
      return new Set<TranslationId>();
    });
  return serverTranslations.then((ids) =>
    TRANSLATIONS.filter((t) => t.source === "bible-api" || ids.has(t.id))
  );
}

const TRANSLATION_KEY = "descartes.translation";

export function loadTranslation(): TranslationId {
  const v = localStorage.getItem(TRANSLATION_KEY);
  return TRANSLATIONS.some((t) => t.id === v) ? (v as TranslationId) : "web";
}

export function saveTranslation(id: TranslationId): void {
  localStorage.setItem(TRANSLATION_KEY, id);
}

/**
 * Does this citation look like a scripture reference we can resolve?
 * Requires "<book> <chapter>:<verse>" so confessional citations like
 * "WCF 7.1" or "Calvin Inst. 3.11" are left alone.
 */
export function looksLikeScripture(ref: string): boolean {
  return /^\s*(?:[1-3]\s*)?[A-Za-z][A-Za-z .]*\s+\d+\s*:\s*\d+/.test(ref);
}

export type PassageResult =
  | { status: "ok"; text: string; translation: TranslationId }
  | { status: "not-found" }
  | { status: "error"; message: string };

interface ApiResponse {
  reference?: string;
  verses?: { verse: number; text: string }[];
  text?: string;
  translation_id?: string;
}

const cache = new Map<string, Promise<PassageResult>>();

// bible-api.com rate-limits per IP; run one request at a time with a gap.
let queue: Promise<unknown> = Promise.resolve();
const GAP_MS = 250;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(
    () => new Promise((r) => setTimeout(r, GAP_MS)),
    () => new Promise((r) => setTimeout(r, GAP_MS))
  );
  return run;
}

function normalise(ref: string): string {
  return ref
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*[-–—]\s*/g, "-");
}

async function requestServer(
  ref: string,
  translation: "esv"
): Promise<PassageResult> {
  try {
    const p = await api.biblePassage(ref, translation);
    return { status: "ok", text: p.text, translation };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) return { status: "not-found" };
      if (err.status === 503) {
        return { status: "error", message: "ESV isn't configured on the server" };
      }
      if (err.status === 401) {
        return { status: "error", message: "Sign in to fetch ESV text" };
      }
      return { status: "error", message: `HTTP ${err.status}` };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}

async function request(
  ref: string,
  translation: TranslationId
): Promise<PassageResult> {
  if (translation === "esv") return requestServer(ref, translation);
  const url = `https://bible-api.com/${encodeURIComponent(ref)}?translation=${translation}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }
  if (res.status === 404) return { status: "not-found" };
  if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };

  const body = (await res.json()) as ApiResponse;
  const verses = body.verses ?? [];
  if (verses.length === 0) {
    const flat = (body.text ?? "").replace(/\s+/g, " ").trim();
    return flat
      ? { status: "ok", text: flat, translation }
      : { status: "not-found" };
  }
  const text = verses
    .map((v) => {
      const t = v.text.replace(/\s+/g, " ").trim();
      return verses.length > 1 ? `${v.verse} ${t}` : t;
    })
    .join(" ");
  return { status: "ok", text, translation };
}

/** Fetch (or return cached) passage text. Errors are not cached. */
export function fetchPassage(
  ref: string,
  translation: TranslationId
): Promise<PassageResult> {
  const key = `${translation}|${normalise(ref).toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = enqueue(() => request(normalise(ref), translation)).then((r) => {
    if (r.status === "error") cache.delete(key);
    return r;
  });
  cache.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Reference parsing + interlinear links
// ---------------------------------------------------------------------------

/**
 * Canonical books with their Bible Hub URL slug and accepted abbreviations.
 * Aliases are matched after lower-casing and stripping spaces and periods, so
 * "1 Sam." / "1Sam" / "I Samuel" all resolve.
 */
const BOOKS: { slug: string; aliases: string[] }[] = [
  { slug: "genesis", aliases: ["genesis", "gen", "ge", "gn"] },
  { slug: "exodus", aliases: ["exodus", "exod", "exo", "ex"] },
  { slug: "leviticus", aliases: ["leviticus", "lev", "le", "lv"] },
  { slug: "numbers", aliases: ["numbers", "num", "nu", "nm", "nb"] },
  { slug: "deuteronomy", aliases: ["deuteronomy", "deut", "deu", "dt"] },
  { slug: "joshua", aliases: ["joshua", "josh", "jos", "jsh"] },
  { slug: "judges", aliases: ["judges", "judg", "jdg", "jg", "jdgs"] },
  { slug: "ruth", aliases: ["ruth", "rth", "ru"] },
  { slug: "1_samuel", aliases: ["1samuel", "1sam", "1sa", "1sm", "1s", "isamuel", "isam"] },
  { slug: "2_samuel", aliases: ["2samuel", "2sam", "2sa", "2sm", "2s", "iisamuel", "iisam"] },
  { slug: "1_kings", aliases: ["1kings", "1kgs", "1ki", "1k", "ikings", "ikgs"] },
  { slug: "2_kings", aliases: ["2kings", "2kgs", "2ki", "2k", "iikings", "iikgs"] },
  { slug: "1_chronicles", aliases: ["1chronicles", "1chron", "1chr", "1ch", "ichronicles", "ichron"] },
  { slug: "2_chronicles", aliases: ["2chronicles", "2chron", "2chr", "2ch", "iichronicles", "iichron"] },
  { slug: "ezra", aliases: ["ezra", "ezr", "ez"] },
  { slug: "nehemiah", aliases: ["nehemiah", "neh", "ne"] },
  { slug: "esther", aliases: ["esther", "esth", "est", "es"] },
  { slug: "job", aliases: ["job", "jb"] },
  { slug: "psalms", aliases: ["psalms", "psalm", "pslm", "psa", "psm", "pss", "ps"] },
  { slug: "proverbs", aliases: ["proverbs", "prov", "pro", "prv", "pr"] },
  { slug: "ecclesiastes", aliases: ["ecclesiastes", "eccles", "eccle", "eccl", "ecc", "ec", "qoheleth", "qoh"] },
  { slug: "songs", aliases: ["songofsolomon", "songofsongs", "song", "sos", "so", "canticles", "cant"] },
  { slug: "isaiah", aliases: ["isaiah", "isa", "is"] },
  { slug: "jeremiah", aliases: ["jeremiah", "jer", "je", "jr"] },
  { slug: "lamentations", aliases: ["lamentations", "lam", "la"] },
  { slug: "ezekiel", aliases: ["ezekiel", "ezek", "eze", "ezk"] },
  { slug: "daniel", aliases: ["daniel", "dan", "da", "dn"] },
  { slug: "hosea", aliases: ["hosea", "hos", "ho"] },
  { slug: "joel", aliases: ["joel", "jl"] },
  { slug: "amos", aliases: ["amos", "am"] },
  { slug: "obadiah", aliases: ["obadiah", "obad", "ob"] },
  { slug: "jonah", aliases: ["jonah", "jnh", "jon"] },
  { slug: "micah", aliases: ["micah", "mic", "mc"] },
  { slug: "nahum", aliases: ["nahum", "nah", "na"] },
  { slug: "habakkuk", aliases: ["habakkuk", "hab", "hb"] },
  { slug: "zephaniah", aliases: ["zephaniah", "zeph", "zep", "zp"] },
  { slug: "haggai", aliases: ["haggai", "hag", "hg"] },
  { slug: "zechariah", aliases: ["zechariah", "zech", "zec", "zc"] },
  { slug: "malachi", aliases: ["malachi", "mal", "ml"] },
  { slug: "matthew", aliases: ["matthew", "matt", "mat", "mt"] },
  { slug: "mark", aliases: ["mark", "mrk", "mar", "mk", "mr"] },
  { slug: "luke", aliases: ["luke", "luk", "lk"] },
  { slug: "john", aliases: ["john", "joh", "jhn", "jn"] },
  { slug: "acts", aliases: ["acts", "act", "ac"] },
  { slug: "romans", aliases: ["romans", "rom", "ro", "rm"] },
  { slug: "1_corinthians", aliases: ["1corinthians", "1cor", "1co", "icorinthians", "icor"] },
  { slug: "2_corinthians", aliases: ["2corinthians", "2cor", "2co", "iicorinthians", "iicor"] },
  { slug: "galatians", aliases: ["galatians", "gal", "ga"] },
  { slug: "ephesians", aliases: ["ephesians", "eph", "ephes"] },
  { slug: "philippians", aliases: ["philippians", "phil", "php", "pp"] },
  { slug: "colossians", aliases: ["colossians", "col", "co"] },
  { slug: "1_thessalonians", aliases: ["1thessalonians", "1thess", "1thes", "1th", "ithessalonians", "ithess"] },
  { slug: "2_thessalonians", aliases: ["2thessalonians", "2thess", "2thes", "2th", "iithessalonians", "iithess"] },
  { slug: "1_timothy", aliases: ["1timothy", "1tim", "1ti", "itimothy", "itim"] },
  { slug: "2_timothy", aliases: ["2timothy", "2tim", "2ti", "iitimothy", "iitim"] },
  { slug: "titus", aliases: ["titus", "tit", "ti"] },
  { slug: "philemon", aliases: ["philemon", "philem", "phm", "pm"] },
  { slug: "hebrews", aliases: ["hebrews", "heb"] },
  { slug: "james", aliases: ["james", "jas", "jm"] },
  { slug: "1_peter", aliases: ["1peter", "1pet", "1pe", "1pt", "1p", "ipeter", "ipet"] },
  { slug: "2_peter", aliases: ["2peter", "2pet", "2pe", "2pt", "2p", "iipeter", "iipet"] },
  { slug: "1_john", aliases: ["1john", "1jhn", "1jn", "1jo", "1j", "ijohn", "ijn"] },
  { slug: "2_john", aliases: ["2john", "2jhn", "2jn", "2jo", "2j", "iijohn", "iijn"] },
  { slug: "3_john", aliases: ["3john", "3jhn", "3jn", "3jo", "3j", "iiijohn", "iiijn"] },
  { slug: "jude", aliases: ["jude", "jud", "jd"] },
  { slug: "revelation", aliases: ["revelation", "revelations", "rev", "re", "therevelation", "apocalypse"] },
];

const BOOK_INDEX = new Map<string, string>();
for (const b of BOOKS) for (const a of b.aliases) BOOK_INDEX.set(a, b.slug);

export interface ParsedReference {
  /** Bible Hub slug, e.g. "1_john". */
  bookSlug: string;
  chapter: number;
  /** First verse of the citation. */
  verse: number;
  /** Last verse when a same-chapter range was given, e.g. 3-8 → 8. */
  verseEnd?: number;
}

/** Parse "<book> <chapter>:<verse>[-<verse>]"; null if unrecognised. */
export function parseReference(ref: string): ParsedReference | null {
  const m = /^\s*([1-3]?\s*[A-Za-z][A-Za-z .]*?)\s*(\d+)\s*:\s*(\d+)(?:\s*[-–—]\s*(?:(\d+)\s*:\s*)?(\d+))?/.exec(
    ref
  );
  if (!m) return null;
  const bookKey = m[1].toLowerCase().replace(/[\s.]/g, "");
  const bookSlug = BOOK_INDEX.get(bookKey);
  if (!bookSlug) return null;
  const chapter = Number(m[2]);
  const verse = Number(m[3]);
  // m[4] is a chapter in a cross-chapter range ("3:16-4:2"); we only link
  // to the start, so ignore the end in that case.
  const verseEnd = m[5] && !m[4] ? Number(m[5]) : undefined;
  return { bookSlug, chapter, verse, verseEnd };
}

/**
 * Bible Hub interlinear page for the first verse of a citation
 * (Hebrew/Greek with Strong's numbers, parsing, and English gloss).
 */
export function interlinearUrl(ref: string): string | null {
  const p = parseReference(ref);
  if (!p) return null;
  return `https://biblehub.com/interlinear/${p.bookSlug}/${p.chapter}-${p.verse}.htm`;
}
