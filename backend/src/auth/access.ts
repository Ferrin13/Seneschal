/**
 * Feature-level access control, kept I/O-free so it can be unit tested.
 *
 * Access is a flat yes/no per product. Products are identified by URL prefix:
 * every route the backend serves must map to exactly one feature here (or be
 * listed as open-to-any-signed-in-user), otherwise the auth middleware rejects
 * it with 403. Default-deny means forgetting to register a new route family
 * fails closed rather than silently exposing it.
 */

export const FEATURES = [
  "time_tracking",
  "expenses",
  "group_texting",
  "deal_hunter",
  "lazax",
  "thrawn",
  "descartes",
  "moneyball",
] as const;

export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  time_tracking: "Time Tracking",
  expenses: "Expense Tracking",
  group_texting: "Group Texting",
  deal_hunter: "Deal Hunter",
  lazax: "Lazax",
  thrawn: "Thrawn",
  descartes: "Descartes",
  moneyball: "Moneyball",
};

export function isFeature(value: unknown): value is Feature {
  return typeof value === "string" && (FEATURES as readonly string[]).includes(value);
}

/** Drop unknown/duplicate entries and return in canonical catalog order. */
export function normalizeFeatures(input: readonly unknown[]): Feature[] {
  const set = new Set(input.filter(isFeature));
  return FEATURES.filter((f) => set.has(f));
}

/**
 * URL prefix → feature. Matched against the path only (query string stripped),
 * on segment boundaries so `/lazax` doesn't accidentally cover `/lazaxfoo`.
 * Longer prefixes win, so `/lazax/ws` could be split out later if needed.
 */
const FEATURE_PREFIXES: ReadonlyArray<readonly [string, Feature]> = [
  // Time tracking (Android primary client, web read-only). The voice
  // assistant is the phone's hands-free front door to time tracking, so it
  // rides on the same permission.
  ["/categories", "time_tracking"],
  ["/activities", "time_tracking"],
  ["/slots", "time_tracking"],
  ["/timer", "time_tracking"],
  ["/voice", "time_tracking"],
  // Expense tracking (receipt images are presigned via /uploads).
  ["/businesses", "expenses"],
  ["/expenses", "expenses"],
  ["/uploads", "expenses"],
  // Group texting.
  ["/groups", "group_texting"],
  ["/group-members", "group_texting"],
  ["/message-templates", "group_texting"],
  // Deal hunter (marketplace pipeline + its model/notification settings).
  ["/marketplace", "deal_hunter"],
  ["/settings", "deal_hunter"],
  // Lazax (REST + the /lazax/ws upgrade).
  ["/lazax", "lazax"],
  // Thrawn.
  ["/thrawn", "thrawn"],
  // Descartes (the ESV proxy exists only for Descartes' scripture refs).
  ["/descartes", "descartes"],
  ["/bible", "descartes"],
  // Moneyball (ultimate frisbee player ratings).
  ["/moneyball", "moneyball"],
];

/** Paths any signed-in account may call regardless of features. */
const OPEN_PREFIXES: readonly string[] = ["/me"];

/** Paths that require the admin flag rather than a feature. */
const ADMIN_PREFIXES: readonly string[] = ["/admin"];

export type PathRequirement =
  | { kind: "open" }
  | { kind: "admin" }
  | { kind: "feature"; feature: Feature }
  | { kind: "unknown" };

function pathOf(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function requirementForPath(url: string): PathRequirement {
  const path = pathOf(url);
  if (OPEN_PREFIXES.some((p) => matchesPrefix(path, p))) return { kind: "open" };
  if (ADMIN_PREFIXES.some((p) => matchesPrefix(path, p))) return { kind: "admin" };
  let best: { prefix: string; feature: Feature } | null = null;
  for (const [prefix, feature] of FEATURE_PREFIXES) {
    if (matchesPrefix(path, prefix) && (!best || prefix.length > best.prefix.length)) {
      best = { prefix, feature };
    }
  }
  return best ? { kind: "feature", feature: best.feature } : { kind: "unknown" };
}

/** What an authenticated principal is allowed to do. */
export type Access = {
  isAdmin: boolean;
  features: Feature[];
  /** True when the email is in BOOTSTRAP_ADMIN_EMAILS (can't be demoted). */
  bootstrap: boolean;
};

export type AccessRow = {
  isAdmin: boolean;
  features: readonly unknown[];
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Combine the stored `user_access` row (if any) with the env bootstrap list.
 * Returns null when the account has no access at all.
 *
 * Bootstrap admins are always admins and, when they have no row yet (first
 * boot before the upsert ran, or the row was deleted by hand), get every
 * feature. Once a row exists its feature list is honored so they can still
 * hide products from themselves.
 */
export function resolveAccess(
  email: string,
  row: AccessRow | null | undefined,
  bootstrapAdmins: readonly string[]
): Access | null {
  const normalized = normalizeEmail(email);
  const bootstrap = bootstrapAdmins.some((e) => normalizeEmail(e) === normalized);
  if (!row && !bootstrap) return null;
  return {
    isAdmin: bootstrap || (row?.isAdmin ?? false),
    features: row ? normalizeFeatures(row.features) : [...FEATURES],
    bootstrap,
  };
}

export function canAccessPath(access: Access, url: string): boolean {
  const req = requirementForPath(url);
  switch (req.kind) {
    case "open":
      return true;
    case "admin":
      return access.isAdmin;
    case "feature":
      return access.features.includes(req.feature);
    case "unknown":
      return false;
  }
}
