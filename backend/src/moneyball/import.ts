/**
 * Moneyball roster import.
 *
 * Scrapes roster web pages (local HTML files, a directory of them, or URLs)
 * into the committed `roster.ts` plus one photo per player under
 * `frontend/public/moneyball/players/`. The server upserts `roster.ts` into
 * `moneyball_players` on boot, so the full flow is:
 *
 *   npx tsx src/moneyball/import.ts "C:\path\to\saved\team\pages" --dry-run
 *   npx tsx src/moneyball/import.ts "C:\path\to\saved\team\pages"
 *   git add src/moneyball/roster.ts ../frontend/public/moneyball/players
 *
 * (`npm run moneyball:import -- ...` works from bash; PowerShell eats the `--`
 * and npm then swallows the flags, so call tsx directly there.)
 *
 * Page shapes supported out of the box:
 *
 * 1. Tiles/cards: elements matched by `--selector`. Default heuristic: any
 *    `<a>`/block wrapping a single `<img>`, plus Ultimate Central style
 *    `a.media-item-tile` tiles. Name comes from `--name-selector`, else a
 *    heading, img `alt`, or link text. Photo comes from `<img src>` or a CSS
 *    `background-image` on the tile. Slug comes from a `/u/<slug>` profile
 *    link when present, else the name.
 * 2. Link-outs (`--follow`): each link points at a per-player page; we fetch it
 *    and take `og:title` / `<h1>` as the name and `og:image` as the photo.
 *
 * Team name is read per page from `--team-selector` (default
 * `.team-show-header h1`, Ultimate Central) and stored on every player found
 * on that page.
 *
 * Always run with `--dry-run` first and eyeball the table it prints. Nothing
 * here touches the database.
 *
 * Options:
 *   --base-url <url>        Resolve relative hrefs/srcs against this (for local
 *                           files whose links are relative)
 *   --selector <css>        Player container selector (default: heuristic)
 *   --name-selector <css>   Name element inside the container
 *   --img-selector <css>    Image element inside the container
 *   --team-selector <css>   Team name element on the page
 *   --team <name>           Force a team name for every player (single page)
 *   --follow                Fetch each linked page for name/photo
 *   --images-dir <path>     Where to write photos
 *                           (default ../frontend/public/moneyball/players)
 *   --out <path>            roster.ts to write (default src/moneyball/roster.ts)
 *   --dry-run               Print what would be imported; write nothing
 *   --keep                  Keep existing roster entries not found on the pages
 */
import * as cheerio from "cheerio";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ROSTER as EXISTING, type RosterEntry } from "./roster.js";

// The backend compiles to CommonJS (no "type": "module"), so __dirname is
// available both under tsx and in dist/.
const HERE = __dirname;
const DEFAULT_IMAGES_DIR = path.resolve(HERE, "../../../frontend/public/moneyball/players");
const DEFAULT_OUT = path.resolve(HERE, "roster.ts");
const PUBLIC_PREFIX = "/moneyball/players";
const DEFAULT_TEAM_SELECTOR = ".team-show-header h1, header h1";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";

type Options = {
  sources: string[];
  baseUrl?: string;
  selector?: string;
  nameSelector?: string;
  imgSelector?: string;
  teamSelector: string;
  team?: string;
  follow: boolean;
  imagesDir: string;
  out: string;
  dryRun: boolean;
  keep: boolean;
};

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    sources: [],
    teamSelector: DEFAULT_TEAM_SELECTOR,
    follow: false,
    imagesDir: DEFAULT_IMAGES_DIR,
    out: DEFAULT_OUT,
    dryRun: false,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--base-url":
        opts.baseUrl = next();
        break;
      case "--selector":
        opts.selector = next();
        break;
      case "--name-selector":
        opts.nameSelector = next();
        break;
      case "--img-selector":
        opts.imgSelector = next();
        break;
      case "--team-selector":
        opts.teamSelector = next();
        break;
      case "--team":
        opts.team = next();
        break;
      case "--follow":
        opts.follow = true;
        break;
      case "--images-dir":
        opts.imagesDir = path.resolve(next());
        break;
      case "--out":
        opts.out = path.resolve(next());
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--keep":
        opts.keep = true;
        break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
        opts.sources.push(a);
    }
  }
  if (opts.sources.length === 0) {
    throw new Error("usage: moneyball:import <file.html|dir|url>... [options]");
  }
  return opts;
}

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(raw: string | undefined | null): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/** Strip common suffixes like " | Team Site" from og:title / <title>. */
function titleToName(title: string): string {
  return cleanText(title.split(/\s[|\-–—]\s/)[0]);
}

function looksLikeName(s: string): boolean {
  if (s.length < 2 || s.length > 60) return false;
  if (/^(home|roster|schedule|about|contact|login|menu|next|previous)$/i.test(s)) return false;
  return /[a-z]/i.test(s);
}

function resolveUrl(href: string | undefined, base: string | undefined): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || h.startsWith("#") || /^(mailto|tel|javascript):/i.test(h)) return null;
  if (h.startsWith("data:")) return h;
  try {
    return base ? new URL(h, base).toString() : new URL(h).toString();
  } catch {
    return null;
  }
}

/** `background-image: url('...')` → the URL, or undefined. */
function backgroundImageOf(style: string | undefined): string | undefined {
  if (!style) return undefined;
  const m = /background(?:-image)?\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(style);
  return m?.[2] || undefined;
}

/** `/u/<slug>` or `/players/<slug>` style profile links → slug. */
function slugFromHref(href: string | null): string | null {
  if (!href) return null;
  try {
    const parts = new URL(href).pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => /^(u|users?|players?|profiles?|people)$/i.test(p));
    const s = i >= 0 ? parts[i + 1] : null;
    return s && /^[a-z0-9-]+$/i.test(s) ? s.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Expand directories to their *.html files; pass files/URLs through. */
async function expandSources(sources: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of sources) {
    if (/^https?:\/\//i.test(s)) {
      out.push(s);
      continue;
    }
    const st = await stat(s);
    if (st.isDirectory()) {
      const files = (await readdir(s)).filter((f) => /\.html?$/i.test(f)).sort();
      out.push(...files.map((f) => path.join(s, f)));
    } else {
      out.push(s);
    }
  }
  return out;
}

async function loadHtml(source: string): Promise<{ html: string; base: string | undefined }> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { headers: { "user-agent": UA } });
    if (!res.ok) throw new Error(`GET ${source} -> ${res.status}`);
    return { html: await res.text(), base: source };
  }
  return { html: await readFile(source, "utf8"), base: undefined };
}

type Found = {
  name: string;
  slug: string;
  photo: string | null;
  href: string | null;
  team: string | null;
};

/** Pull player candidates out of one roster page. */
function extractFromPage(html: string, base: string | undefined, opts: Options): Found[] {
  const $ = cheerio.load(html);
  const found: Found[] = [];
  const seen = new Set<string>();

  const team =
    opts.team ??
    (cleanText($(opts.teamSelector).first().text()) ||
      titleToName($('meta[property="og:title"]').attr("content") ?? "") ||
      null);

  const push = (f: Omit<Found, "slug"> & { slug?: string | null }) => {
    const slug = f.slug || slugify(f.name);
    if (!slug || seen.has(slug) || !looksLikeName(f.name)) return;
    seen.add(slug);
    found.push({ ...f, slug });
  };

  // Most specific selector that matches anything wins; the generic heuristic
  // is a last resort because it also picks up logos and nav avatars.
  const candidateSelectors = opts.selector
    ? [opts.selector]
    : [
        // Ultimate Central style tiles (photo as CSS background).
        "a.media-item-tile",
        // Generic: anything that directly wraps exactly one image and has
        // some text (cards, list items, links).
        "a:has(img), li:has(img), article:has(img), figure:has(img), div:has(> img)",
      ];
  let containers: ReturnType<typeof $>[number][] = [];
  for (const sel of candidateSelectors) {
    containers = $(sel)
      .toArray()
      .filter((el) => $(el).find("img").length <= 1);
    if (containers.length > 0) break;
  }

  for (const el of containers) {
    const c = $(el);
    const img = opts.imgSelector ? c.find(opts.imgSelector).first() : c.find("img").first();
    const src =
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      img.attr("src") ||
      backgroundImageOf(c.attr("style")) ||
      backgroundImageOf(c.find("[style*=background]").first().attr("style")) ||
      undefined;
    const nameEl = opts.nameSelector ? c.find(opts.nameSelector).first() : null;
    const name =
      cleanText(nameEl?.text()) ||
      cleanText(c.find("h1,h2,h3,h4,h5,.name,[class*=name]").first().text()) ||
      cleanText(img.attr("alt")) ||
      cleanText(c.is("a") ? c.text() : c.find("a").first().text()) ||
      cleanText(c.text());
    const hrefRaw = c.is("a") ? c.attr("href") : c.find("a[href]").first().attr("href");
    const href = resolveUrl(hrefRaw, base);
    push({ name, slug: slugFromHref(href), photo: resolveUrl(src, base), href, team });
  }

  // Link-out mode without cards: every distinct link is a candidate.
  if (opts.follow && found.length === 0) {
    $("a[href]").each((_, a) => {
      const href = resolveUrl($(a).attr("href"), base);
      if (!href) return;
      push({ name: cleanText($(a).text()) || href, slug: slugFromHref(href), photo: null, href, team });
    });
  }
  return found;
}

/** Visit a per-player page and fill in name/photo from its metadata. */
async function enrichFromLinkedPage(f: Found): Promise<Found> {
  if (!f.href) return f;
  try {
    const res = await fetch(f.href, { headers: { "user-agent": UA } });
    if (!res.ok) return f;
    const $ = cheerio.load(await res.text());
    const ogTitle = $('meta[property="og:title"]').attr("content");
    const h1 = cleanText($("h1").first().text());
    const title = $("title").first().text();
    const ogImage = $('meta[property="og:image"]').attr("content");
    const firstImg =
      $("main img, article img, .content img, img").first().attr("src") || undefined;
    return {
      ...f,
      name: h1 || (ogTitle ? titleToName(ogTitle) : "") || titleToName(title) || f.name,
      photo: resolveUrl(ogImage, f.href) ?? resolveUrl(firstImg, f.href) ?? f.photo,
    };
  } catch {
    return f;
  }
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

async function downloadPhoto(url: string, slug: string, dir: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const fromPath = path.extname(new URL(url).pathname).replace(".", "").toLowerCase();
    const ext = EXT_BY_TYPE[type] ?? (fromPath || "jpg");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("empty body");
    await mkdir(dir, { recursive: true });
    const file = `${slug}.${ext}`;
    await writeFile(path.join(dir, file), buf);
    return `${PUBLIC_PREFIX}/${file}`;
  } catch (err) {
    console.warn(`  ! photo for ${slug} failed: ${(err as Error).message}`);
    return null;
  }
}

function renderRoster(entries: readonly RosterEntry[]): string {
  const lines = entries.map((e) => {
    const parts = [
      `slug: ${JSON.stringify(e.slug)}`,
      `name: ${JSON.stringify(e.name)}`,
      `photoUrl: ${JSON.stringify(e.photoUrl)}`,
    ];
    if (e.team != null) parts.push(`team: ${JSON.stringify(e.team)}`);
    if (e.number != null) parts.push(`number: ${e.number}`);
    return `  { ${parts.join(", ")} },`;
  });
  return `/**
 * Moneyball roster — GENERATED by \`npm run moneyball:import\`, do not hand-edit
 * beyond quick fixes. Upserted into moneyball_players (by slug) on server
 * start, so adding a player here and deploying is enough to make them appear.
 *
 * \`photoUrl\` is site-relative: the import script drops images under
 * frontend/public/moneyball/players/ and the web UI serves them as-is.
 */
export type RosterEntry = {
  slug: string;
  name: string;
  photoUrl: string | null;
  team?: string | null;
  number?: number | null;
};

export const ROSTER: readonly RosterEntry[] = [
${lines.join("\n")}
];
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sources = await expandSources(opts.sources);
  if (sources.length === 0) throw new Error("no .html files found in the given sources");

  // Merge across pages by slug; first page to mention a player wins its team.
  const bySlug = new Map<string, Found>();
  for (const source of sources) {
    const { html, base } = await loadHtml(source);
    let found = extractFromPage(html, opts.baseUrl ?? base, opts);
    if (opts.follow) {
      console.log(`Following ${found.length} links from ${path.basename(source)}...`);
      found = await Promise.all(found.map(enrichFromLinkedPage));
    }
    const team = found[0]?.team ?? "(no team)";
    console.log(`${path.basename(source)}: ${found.length} players, team "${team}"`);
    for (const f of found) if (!bySlug.has(f.slug)) bySlug.set(f.slug, f);
  }

  const all = [...bySlug.values()].sort(
    (a, b) => (a.team ?? "").localeCompare(b.team ?? "") || a.name.localeCompare(b.name)
  );
  if (all.length === 0) {
    console.error(
      "No players found. Try --selector/--name-selector/--img-selector, or --follow for link-out pages."
    );
    process.exit(2);
  }

  console.log(`\nFound ${all.length} players:`);
  for (const f of all) {
    console.log(
      `  ${f.slug.padEnd(26)} ${f.name.padEnd(26)} ${(f.team ?? "").padEnd(36)} ${f.photo ? "photo" : "(no photo)"}`
    );
  }
  if (opts.dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const entries: RosterEntry[] = [];
  for (const f of all) {
    const existing = EXISTING.find((e) => e.slug === f.slug);
    let photoUrl: string | null = existing?.photoUrl ?? null;
    if (f.photo) {
      const downloaded = await downloadPhoto(f.photo, f.slug, opts.imagesDir);
      if (downloaded) photoUrl = downloaded;
    } else if (photoUrl && !existsSync(path.join(opts.imagesDir, path.basename(photoUrl)))) {
      photoUrl = null;
    }
    entries.push({
      slug: f.slug,
      name: f.name,
      photoUrl,
      team: f.team ?? existing?.team ?? null,
      number: existing?.number ?? null,
    });
  }
  if (opts.keep) {
    for (const e of EXISTING) {
      if (!entries.some((x) => x.slug === e.slug)) entries.push(e);
    }
  }
  entries.sort(
    (a, b) => (a.team ?? "").localeCompare(b.team ?? "") || a.name.localeCompare(b.name)
  );

  await writeFile(opts.out, renderRoster(entries), "utf8");
  const withPhoto = entries.filter((e) => e.photoUrl).length;
  console.log(`\nWrote ${entries.length} players (${withPhoto} with photos) to ${opts.out}`);
  console.log(`Photos in ${opts.imagesDir}`);
  console.log("Commit both, deploy, and the server will upsert the roster on boot.");
}

if (process.argv[1] && /import\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
