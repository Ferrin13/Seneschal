import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
  primaryKey,
  uniqueIndex,
  index,
  check,
  jsonb,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Top-level "kind" of a category. Drives default colors and aggregate
 * groupings on the stats screen. The user's named categories from the spec
 * map 1:1 to these kinds at seed time.
 */
export const categoryKind = pgEnum("category_kind", [
  "good",
  "necessary_good",
  "necessary_inconvenient",
  "good_entertainment",
  "not_best",
  "waste",
  "spiritual",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firebaseUid: text("firebase_uid").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    firebaseUidIdx: uniqueIndex("users_firebase_uid_idx").on(t.firebaseUid),
  })
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    color: text("color").notNull(), // hex string e.g. #4CAF50
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("categories_user_idx").on(t.userId),
    userNameIdx: uniqueIndex("categories_user_name_idx").on(t.userId, t.name),
  })
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("activities_user_idx").on(t.userId),
    userNameIdx: uniqueIndex("activities_user_name_idx").on(t.userId, t.name),
    categoryIdx: index("activities_category_idx").on(t.categoryId),
  })
);

/**
 * One row per 15-minute slot the user has logged. The composite primary key
 * (user_id, slot_start_utc) keeps inserts idempotent and guarantees we never
 * have overlapping primary activities for the same wall-clock slot.
 *
 * `client_updated_at` is what we use for last-write-wins reconciliation
 * during sync; `updated_at` is server-side bookkeeping.
 */
export const timeSlots = pgTable(
  "time_slots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slotStartUtc: timestamp("slot_start_utc", {
      withTimezone: true,
      precision: 0,
    }).notNull(),
    primaryActivityId: uuid("primary_activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "restrict" }),
    secondaryActivityId: uuid("secondary_activity_id").references(
      () => activities.id,
      { onDelete: "set null" }
    ),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.slotStartUtc] }),
    userTimeIdx: index("time_slots_user_time_idx").on(t.userId, t.slotStartUtc),
    userUpdatedIdx: index("time_slots_user_updated_idx").on(
      t.userId,
      t.updatedAt
    ),
    quarterHourCheck: check(
      "time_slots_quarter_hour_check",
      sql`(EXTRACT(MINUTE FROM ${t.slotStartUtc})::int % 15 = 0) AND (EXTRACT(SECOND FROM ${t.slotStartUtc})::int = 0)`
    ),
  })
);

export const runningTimers = pgTable("running_timers", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  primaryActivityId: uuid("primary_activity_id")
    .notNull()
    .references(() => activities.id, { onDelete: "restrict" }),
  secondaryActivityId: uuid("secondary_activity_id").references(
    () => activities.id,
    { onDelete: "set null" }
  ),
  notes: text("notes"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The fixed list of "businesses" an expense can be tagged with. Modeled as
 * a per-user table (rather than a Postgres enum) so the values can be
 * managed via SQL without a migration. The seed list ships on first
 * sign-in via `seedUserDefaults`. There is no public CREATE/UPDATE/DELETE
 * surface for v1.
 */
export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("businesses_user_idx").on(t.userId),
    userNameIdx: uniqueIndex("businesses_user_name_idx").on(t.userId, t.name),
  })
);

/**
 * One expense entry. The minimum payload is `(businessId, occurredOn)`;
 * everything else is optional. `imageKey` is the S3 object key for an
 * attached receipt photo (uploaded out-of-band via presigned PUT) — null
 * when no image is attached.
 *
 * `client_updated_at` drives last-write-wins reconciliation during sync,
 * matching `time_slots` semantics.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    // The wall-clock moment the expense happened. Stored as
    // `timestamp with time zone` so the client's local time round-trips
    // even when users are in different zones.
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    amountCents: integer("amount_cents"),
    note: text("note"),
    imageKey: text("image_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userOccurredIdx: index("expenses_user_occurred_idx").on(
      t.userId,
      t.occurredAt
    ),
    userUpdatedIdx: index("expenses_user_updated_idx").on(
      t.userId,
      t.updatedAt
    ),
    businessIdx: index("expenses_business_idx").on(t.businessId),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type TimeSlot = typeof timeSlots.$inferSelect;
export type NewTimeSlot = typeof timeSlots.$inferInsert;
export type RunningTimer = typeof runningTimers.$inferSelect;
export type NewRunningTimer = typeof runningTimers.$inferInsert;
export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

/**
 * A reusable plain-text message body the user can send to a group via the
 * group-texting flow. v1 has no variable interpolation; the body is sent
 * verbatim to each recipient. Synced offline-first using the same
 * `client_updated_at` LWW pattern as expenses.
 */
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("message_templates_user_idx").on(t.userId),
    userUpdatedIdx: index("message_templates_user_updated_idx").on(
      t.userId,
      t.updatedAt
    ),
  })
);

/**
 * A named bag of contacts the user can send a message template to. Members
 * live in `group_members`. Soft-deleted via `deletedAt`.
 */
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("groups_user_idx").on(t.userId),
    userUpdatedIdx: index("groups_user_updated_idx").on(t.userId, t.updatedAt),
  })
);

/**
 * A single contact (display name + phone number) within a group. We snapshot
 * the name and number into our own row rather than reading from the system
 * Contacts provider on every send, so messages still work if the contact
 * changes or the user revokes contacts access. `contactLookupKey` is kept
 * around so we can re-pick the same contact later if desired.
 *
 * Group deletion uses `onDelete: restrict` because groups are soft-deleted
 * (we never actually drop the parent row); members are independently
 * soft-deleted via the same outbox upsert path.
 */
export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    phoneNumber: text("phone_number").notNull(),
    contactLookupKey: text("contact_lookup_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userGroupIdx: index("group_members_user_group_idx").on(t.userId, t.groupId),
    userUpdatedIdx: index("group_members_user_updated_idx").on(
      t.userId,
      t.updatedAt
    ),
  })
);

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;

/* ======================================================================
 * Marketplace deal-finder
 *
 * A pipeline that turns natural-language shopping targets into Facebook
 * Marketplace saved searches, ingests FB email alerts, triages candidates
 * with a cheap LLM, deep-scrapes promising listings via a browser agent,
 * evaluates them with an advanced LLM against price comps, and surfaces
 * good deals. All tables are per-user (single tenant today) and follow the
 * existing timestamp / soft-delete conventions.
 * ==================================================================== */

export const searchSource = pgEnum("mp_search_source", ["llm", "user"]);
/** The marketplace a search/candidate/listing belongs to. */
export const mpPlatform = pgEnum("mp_platform", ["facebook", "craigslist"]);
/** Lifecycle of a tracked candidate: still live, sold, or vanished. */
export const candidateStatus = pgEnum("mp_candidate_status", [
  "active",
  "sold",
  "disappeared",
]);
/** A step in a candidate's pipeline history, logged to mp_candidate_events. */
export const candidateStage = pgEnum("mp_candidate_stage", [
  "discovered",
  "triaged",
  "deep_scraped",
  "comps_gathered",
  "evaluated",
  "sold",
  "disappeared",
  "error",
]);
export const triageStatus = pgEnum("mp_triage_status", [
  "pending",
  "promising",
  "rejected",
  "skipped",
]);
/**
 * User's manual disposition of a deal (distinct from the system-detected
 * `candidateStatus`). `not_a_fit` and `sold` are terminal — the hunt pipeline
 * stops updating those candidates.
 */
export const dispositionStatus = pgEnum("mp_disposition", [
  "none",
  "not_a_fit",
  "not_a_good_deal",
  "keep_watching",
  "reached_out",
  "sold",
]);
export const scrapeStatus = pgEnum("mp_scrape_status", [
  "ok",
  "partial",
  "failed",
]);
export const evaluationTier = pgEnum("mp_evaluation_tier", [
  "triage",
  "advanced",
]);
export const evaluationVerdict = pgEnum("mp_evaluation_verdict", [
  "good_deal",
  "pass",
  "unsure",
]);
export const compSource = pgEnum("mp_comp_source", [
  "ebay",
  "craigslist",
  "internal",
  "web",
]);
/**
 * Whether a comparable reflects a brand-new/retail price or a used/secondhand
 * resale price. Null for sources where the distinction doesn't apply (e.g.
 * internal history predating this split).
 */
export const compCondition = pgEnum("mp_comp_condition", ["new", "used"]);
export const notificationStatus = pgEnum("mp_notification_status", [
  "new",
  "seen",
  "actioned",
  "dismissed",
]);
export const agentStatus = pgEnum("mp_agent_status", [
  "online",
  "offline",
  "needs_login",
]);
export const llmPurpose = pgEnum("mp_llm_purpose", [
  "search_expansion",
  "triage",
  "comps",
  "advanced",
  "other",
]);
/** Lifecycle of a single hunt-workflow run recorded in mp_hunt_runs. */
export const huntRunStatus = pgEnum("mp_hunt_run_status", [
  "running",
  "completed",
  "failed",
]);

/**
 * A natural-language shopping target, e.g. "high quality hardcover books" or
 * "mid-century patio furniture". `evalInstructions` is free-form guidance the
 * LLM applies when triaging/evaluating candidates for this target
 * (e.g. "ignore anything in a light color").
 */
export const searchTargets = pgTable(
  "mp_search_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    evalInstructions: text("eval_instructions"),
    isActive: boolean("is_active").notNull().default(true),
    // Per-target auto-hunt cadence in minutes. NULL falls back to the server's
    // TEMPORAL_HUNT_INTERVAL_MIN default so existing targets keep working.
    huntIntervalMin: integer("hunt_interval_min"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("mp_search_targets_user_idx").on(t.userId),
  })
);

/**
 * A concrete Marketplace search derived from a target — either expanded by
 * the LLM (`source = 'llm'`) or entered by the user. `filters` holds the
 * structured constraints (max price, radius, category, etc.); `fbSearchUrl`
 * is the ready-to-open URL the user turns into a saved search + email alert.
 */
export const searches = pgTable(
  "mp_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => searchTargets.id, { onDelete: "cascade" }),
    // Marketplace this search runs against. A single target fans out into
    // per-platform searches.
    platform: mpPlatform("platform").notNull().default("facebook"),
    query: text("query").notNull(),
    filters: jsonb("filters"),
    // Ready-to-open search URL (property renamed from fbSearchUrl; the DB
    // column stays `fb_search_url` for backward compatibility).
    searchUrl: text("fb_search_url"),
    source: searchSource("source").notNull().default("llm"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("mp_searches_user_idx").on(t.userId),
    targetIdx: index("mp_searches_target_idx").on(t.targetId),
  })
);

/**
 * A single listing candidate harvested from a search snapshot: just enough
 * (title, thumbnail, price, blurb) for the cheap LLM to triage. `dedupeKey`
 * (typically the platform item id) is unique per user so the same item
 * appearing across overlapping searches is only tracked once. Seen/lifecycle
 * timestamps drive sold-disappearance detection.
 */
export const candidates = pgTable(
  "mp_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    searchId: uuid("search_id").references(() => searches.id, {
      onDelete: "set null",
    }),
    platform: mpPlatform("platform").notNull().default("facebook"),
    // Platform item id (property renamed from fbItemId; DB column stays
    // `fb_item_id`).
    externalId: text("fb_item_id"),
    listingUrl: text("listing_url").notNull(),
    title: text("title"),
    thumbnailUrl: text("thumbnail_url"),
    priceCents: integer("price_cents"),
    blurb: text("blurb"),
    dedupeKey: text("dedupe_key").notNull(),
    triageStatus: triageStatus("triage_status").notNull().default("pending"),
    triageScore: integer("triage_score"),
    triageReason: text("triage_reason"),
    // Ranking hint for the UI (higher = more promising). Derived from triage
    // score and, later, the advanced verdict/confidence.
    promiseScore: integer("promise_score"),
    // Lifecycle + when the source says the listing was posted/updated.
    status: candidateStatus("status").notNull().default("active"),
    // User's manual disposition; `not_a_fit`/`sold` freeze the candidate.
    disposition: dispositionStatus("disposition").notNull().default("none"),
    dispositionNote: text("disposition_note"),
    dispositionAt: timestamp("disposition_at", { withTimezone: true }),
    sourceListedAt: timestamp("source_listed_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    // Snapshot-run bookkeeping for sold/disappearance detection.
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    missedRuns: integer("missed_runs").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("mp_candidates_user_idx").on(t.userId),
    userDedupeIdx: uniqueIndex("mp_candidates_user_dedupe_idx").on(
      t.userId,
      t.dedupeKey
    ),
    triageIdx: index("mp_candidates_triage_idx").on(t.userId, t.triageStatus),
    promiseIdx: index("mp_candidates_promise_idx").on(
      t.userId,
      t.promiseScore
    ),
  })
);

/**
 * The full listing record produced by the browser agent scraping the PDP.
 * `rawExtract` holds Facebook's embedded JSON payload for phase-2 re-parsing
 * / LLM context; `htmlKey` points at the raw HTML snapshot in S3.
 */
export const listings = pgTable(
  "mp_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").references(() => candidates.id, {
      onDelete: "set null",
    }),
    platform: mpPlatform("platform").notNull().default("facebook"),
    // Platform item id (property renamed from fbItemId; DB column stays
    // `fb_item_id`).
    externalId: text("fb_item_id"),
    url: text("url").notNull(),
    title: text("title"),
    description: text("description"),
    priceCents: integer("price_cents"),
    currency: text("currency"),
    conditionCode: text("condition_code"),
    conditionLabel: text("condition_label"),
    categoryId: text("category_id"),
    categoryPath: jsonb("category_path"),
    locationText: text("location_text"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    sellerId: text("seller_id"),
    sellerName: text("seller_name"),
    sellerProfileUrl: text("seller_profile_url"),
    sellerRatingAverage: doublePrecision("seller_rating_average"),
    sellerRatingCount: integer("seller_rating_count"),
    availabilityStatus: text("availability_status"),
    isSold: boolean("is_sold"),
    isPending: boolean("is_pending"),
    listedAt: timestamp("listed_at", { withTimezone: true }),
    // When the source last reported the listing as updated (Craigslist).
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    // Snapshot-run bookkeeping: last time we saw it in a search, and when it
    // dropped off (implying it sold / was removed).
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
    rawExtract: jsonb("raw_extract"),
    htmlKey: text("html_key"),
    scrapeStatus: scrapeStatus("scrape_status").notNull().default("ok"),
    scrapeError: text("scrape_error"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("mp_listings_user_idx").on(t.userId),
    userItemIdx: uniqueIndex("mp_listings_user_item_idx").on(
      t.userId,
      t.platform,
      t.externalId
    ),
    candidateIdx: index("mp_listings_candidate_idx").on(t.candidateId),
  })
);

/**
 * One image belonging to a scraped listing. `imageKey` is the S3 object the
 * agent uploaded (FB CDN URLs expire, so we persist the bytes); `sourceUrl`
 * keeps the original for reference.
 */
export const listingImages = pgTable(
  "mp_listing_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url"),
    imageKey: text("image_key"),
    width: integer("width"),
    height: integer("height"),
    caption: text("caption"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    listingIdx: index("mp_listing_images_listing_idx").on(t.listingId),
  })
);

/**
 * A price comparable pulled from an external marketplace (eBay/Craigslist) or
 * our own history (`internal`), used to judge whether a listing is a deal.
 */
export const comps = pgTable(
  "mp_comps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    source: compSource("source").notNull(),
    condition: compCondition("condition"),
    matchedTitle: text("matched_title"),
    priceCents: integer("price_cents"),
    currency: text("currency"),
    url: text("url"),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    listingIdx: index("mp_comps_listing_idx").on(t.listingId),
  })
);

/**
 * An LLM decision. `tier = 'triage'` rows are cheap-model calls on a
 * candidate (title/thumb/price/blurb); `tier = 'advanced'` rows are the
 * capable-model calls on a fully scraped listing + comps. Inputs/outputs are
 * persisted for auditing and prompt-version comparisons.
 */
export const evaluations = pgTable(
  "mp_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").references(() => candidates.id, {
      onDelete: "cascade",
    }),
    listingId: uuid("listing_id").references(() => listings.id, {
      onDelete: "cascade",
    }),
    tier: evaluationTier("tier").notNull(),
    model: text("model"),
    verdict: evaluationVerdict("verdict"),
    // Deal quality (price vs. market) and target-fit, each 0-100. `verdict` is
    // retained for backward compatibility, derived from `valueScore`.
    valueScore: integer("value_score"),
    fitScore: integer("fit_score"),
    confidence: doublePrecision("confidence"),
    estimatedValueCents: integer("estimated_value_cents"),
    rationale: text("rationale"),
    promptVersion: text("prompt_version"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("mp_evaluations_user_idx").on(t.userId),
    candidateIdx: index("mp_evaluations_candidate_idx").on(t.candidateId),
    listingIdx: index("mp_evaluations_listing_idx").on(t.listingId),
  })
);

/**
 * A user's feedback on how accurate an evaluation was, used to improve the
 * scoring pipeline. Each rating scores the accuracy of the fit score and the
 * deal (value) score independently on a 1-10 scale, each with an optional
 * free-form note. Keyed per user + candidate (one editable rating per deal);
 * `evaluationId` records which advanced evaluation was on screen when rated.
 */
export const evaluationRatings = pgTable(
  "mp_evaluation_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    evaluationId: uuid("evaluation_id").references(() => evaluations.id, {
      onDelete: "set null",
    }),
    // Accuracy of the fit score (target match), 1-10. Null until the user rates.
    fitAccuracy: integer("fit_accuracy"),
    fitNote: text("fit_note"),
    // Accuracy of the deal/value score (price vs. market), 1-10.
    valueAccuracy: integer("value_accuracy"),
    valueNote: text("value_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userCandidateIdx: uniqueIndex("mp_evaluation_ratings_user_candidate_idx").on(
      t.userId,
      t.candidateId
    ),
    candidateIdx: index("mp_evaluation_ratings_candidate_idx").on(t.candidateId),
    fitAccuracyCheck: check(
      "mp_evaluation_ratings_fit_accuracy_check",
      sql`${t.fitAccuracy} IS NULL OR (${t.fitAccuracy} BETWEEN 1 AND 10)`
    ),
    valueAccuracyCheck: check(
      "mp_evaluation_ratings_value_accuracy_check",
      sql`${t.valueAccuracy} IS NULL OR (${t.valueAccuracy} BETWEEN 1 AND 10)`
    ),
  })
);

/**
 * A normalized price observation, appended for every candidate/listing/comp
 * we see. This is the growing internal history the evaluator compares against
 * over time.
 */
export const itemObservations = pgTable(
  "mp_item_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category"),
    normalizedTitle: text("normalized_title"),
    priceCents: integer("price_cents"),
    currency: text("currency"),
    source: compSource("source").notNull().default("internal"),
    listingId: uuid("listing_id").references(() => listings.id, {
      onDelete: "set null",
    }),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("mp_item_observations_user_idx").on(t.userId),
    titleIdx: index("mp_item_observations_title_idx").on(
      t.userId,
      t.normalizedTitle
    ),
    // One observation per (user, listing, title, source): repeated deep-scrapes
    // update the existing row's price instead of appending duplicates.
    uniq: uniqueIndex("mp_item_observations_uniq_idx").on(
      t.userId,
      t.listingId,
      t.normalizedTitle,
      t.source
    ),
  })
);

/**
 * A surfaced deal for the user to review. Created when the advanced evaluator
 * returns a `good_deal` verdict.
 */
export const notifications = pgTable(
  "mp_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id").references(() => listings.id, {
      onDelete: "cascade",
    }),
    evaluationId: uuid("evaluation_id").references(() => evaluations.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull().default("deal"),
    title: text("title"),
    body: text("body"),
    status: notificationStatus("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userStatusIdx: index("mp_notifications_user_status_idx").on(
      t.userId,
      t.status
    ),
  })
);

/**
 * Append-only history of pipeline steps for a candidate, powering the UI
 * timeline. Each hunt-workflow activity logs a stage transition here with a
 * free-form `detail` payload (verdict, score, model, cost, counts, etc.) and
 * the Temporal workflow/run ids for traceability.
 */
export const candidateEvents = pgTable(
  "mp_candidate_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    stage: candidateStage("stage").notNull(),
    message: text("message"),
    detail: jsonb("detail"),
    workflowId: text("workflow_id"),
    runId: text("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    candidateIdx: index("mp_candidate_events_candidate_idx").on(
      t.candidateId,
      t.createdAt
    ),
  })
);

/**
 * A registered browser box / scraper agent. Tracks liveness and whether the
 * Facebook session needs a manual re-login (set by the agent when it hits a
 * login wall), which drives a `needs_login` notification to the user.
 */
export const browserAgents = pgTable(
  "mp_browser_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: agentStatus("status").notNull().default("offline"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    needsLoginSince: timestamp("needs_login_since", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userNameIdx: uniqueIndex("mp_browser_agents_user_name_idx").on(
      t.userId,
      t.name
    ),
  })
);

/**
 * One LLM API call (via OpenRouter), logged for cost accounting and model
 * comparison. Every call site (search expansion, triage, advanced eval)
 * records token counts and the USD cost OpenRouter reports, tagged with the
 * model used so different models can be evaluated against each other.
 */
export const llmCalls = pgTable(
  "mp_llm_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: llmPurpose("purpose").notNull(),
    provider: text("provider").notNull().default("openrouter"),
    model: text("model").notNull(),
    requestId: text("request_id"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: doublePrecision("cost_usd"),
    candidateId: uuid("candidate_id").references(() => candidates.id, {
      onDelete: "set null",
    }),
    listingId: uuid("listing_id").references(() => listings.id, {
      onDelete: "set null",
    }),
    targetId: uuid("target_id").references(() => searchTargets.id, {
      onDelete: "set null",
    }),
    // Temporal run id of the hunt-workflow execution that made this call, when
    // it originated from a hunt run. Lets us sum per-run LLM cost accurately.
    runId: text("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("mp_llm_calls_user_idx").on(t.userId, t.createdAt),
    modelIdx: index("mp_llm_calls_model_idx").on(t.userId, t.model),
    runIdx: index("mp_llm_calls_run_idx").on(t.runId),
  })
);

/**
 * One row per execution of the `huntTargetWorkflow`, written when the run
 * starts (status `running`) and finalized when it ends (`completed`/`failed`).
 * Captures the run's outcome counts and total LLM cost so hunt runs are
 * first-class and queryable (history, cost trends, failure rates) rather than
 * living only in Temporal's own history. `runId` is the Temporal run id, which
 * also tags `mp_llm_calls` rows so per-run cost can be summed exactly.
 */
export const huntRuns = pgTable(
  "mp_hunt_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: uuid("target_id").references(() => searchTargets.id, {
      onDelete: "set null",
    }),
    workflowId: text("workflow_id").notNull(),
    runId: text("run_id").notNull(),
    status: huntRunStatus("status").notNull().default("running"),
    // Outcome counts for the run.
    searches: integer("searches").notNull().default(0),
    discovered: integer("discovered").notNull().default(0),
    triaged: integer("triaged").notNull().default(0),
    promising: integer("promising").notNull().default(0),
    evaluated: integer("evaluated").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    // Total OpenRouter cost (USD) summed from mp_llm_calls for this run.
    costUsd: doublePrecision("cost_usd"),
    // Set when the run failed outright (as opposed to per-listing errors).
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userStartedIdx: index("mp_hunt_runs_user_started_idx").on(
      t.userId,
      t.startedAt
    ),
    targetIdx: index("mp_hunt_runs_target_idx").on(t.targetId),
    runIdx: uniqueIndex("mp_hunt_runs_run_idx").on(t.runId),
  })
);

/**
 * Browser-notification preferences: which deals raise a notification and get
 * pushed to the user's browser. Thresholds gate notification creation; a
 * `null`/empty `targetIds` means "all targets".
 */
export type NotificationPrefs = {
  /** Master switch for showing browser (OS) notifications in the client. */
  enabled: boolean;
  /** Minimum combined deal (promise) score, 0-100. */
  minDealScore: number;
  /** Minimum value score (price vs. market), 0-100. */
  minValueScore: number;
  /** Only notify for deals at or under this price (cents); null = no cap. */
  maxPriceCents: number | null;
  /** Targets to notify for; null or empty = every target. */
  targetIds: string[] | null;
};

/**
 * Per-user preferences. `modelOverrides` maps a pipeline step (e.g. "triage",
 * "advanced") to the OpenRouter model slug to use for it; missing steps fall
 * back to the server's tier defaults. `notificationPrefs` controls which deals
 * raise a browser notification.
 */
export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  modelOverrides: jsonb("model_overrides")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  notificationPrefs: jsonb("notification_prefs")
    .$type<NotificationPrefs>()
    .notNull()
    .default({
      enabled: false,
      minDealScore: 0,
      minValueScore: 65,
      maxPriceCents: null,
      targetIds: null,
    }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;

// ---------------------------------------------------------------------------
// Lazax — Twilight Imperium turn timer
// ---------------------------------------------------------------------------

export const lazaxGameStatus = pgEnum("lazax_game_status", [
  "setup",
  "active",
  "finished",
]);

export const lazaxPhase = pgEnum("lazax_phase", [
  "strategy",
  "action",
  "status",
  "agenda",
]);

export const lazaxClockState = pgEnum("lazax_clock_state", [
  "running",
  "paused",
]);

export const lazaxActionState = pgEnum("lazax_action_state", [
  "ready",
  "exhausted",
  "passed",
]);

export const lazaxSegmentKind = pgEnum("lazax_segment_kind", [
  "player",
  "general",
]);

/**
 * A Lazax game session. Speaker / active player are plain UUIDs (not FKs) to
 * avoid a circular reference with lazax_players.
 */
export const lazaxGames = pgTable(
  "lazax_games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Twilight Imperium"),
    status: lazaxGameStatus("status").notNull().default("setup"),
    phase: lazaxPhase("phase").notNull().default("strategy"),
    roundNumber: integer("round_number").notNull().default(1),
    speakerPlayerId: uuid("speaker_player_id"),
    activePlayerId: uuid("active_player_id"),
    clockState: lazaxClockState("clock_state").notNull().default("paused"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerIdx: index("lazax_games_owner_idx").on(t.ownerUserId),
    ownerUpdatedIdx: index("lazax_games_owner_updated_idx").on(
      t.ownerUserId,
      t.updatedAt
    ),
  })
);

export const lazaxPlayers = pgTable(
  "lazax_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => lazaxGames.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    factionId: text("faction_id").notNull(),
    seatIndex: integer("seat_index").notNull(),
    strategyCard: integer("strategy_card"),
    actionState: lazaxActionState("action_state").notNull().default("ready"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    gameIdx: index("lazax_players_game_idx").on(t.gameId),
    gameSeatIdx: uniqueIndex("lazax_players_game_seat_idx").on(
      t.gameId,
      t.seatIndex
    ),
    gameFactionIdx: uniqueIndex("lazax_players_game_faction_idx").on(
      t.gameId,
      t.factionId
    ),
    seatNonNeg: check("lazax_players_seat_nonneg", sql`${t.seatIndex} >= 0`),
    strategyCardRange: check(
      "lazax_players_strategy_card_range",
      sql`${t.strategyCard} IS NULL OR (${t.strategyCard} >= 1 AND ${t.strategyCard} <= 8)`
    ),
  })
);

export const lazaxTimeSegments = pgTable(
  "lazax_time_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => lazaxGames.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").references(() => lazaxPlayers.id, {
      onDelete: "set null",
    }),
    kind: lazaxSegmentKind("kind").notNull(),
    phase: lazaxPhase("phase").notNull(),
    roundNumber: integer("round_number").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    gameIdx: index("lazax_time_segments_game_idx").on(t.gameId),
    gameStartedIdx: index("lazax_time_segments_game_started_idx").on(
      t.gameId,
      t.startedAt
    ),
    openSegmentIdx: index("lazax_time_segments_open_idx").on(
      t.gameId,
      t.endedAt
    ),
  })
);

// ---------------------------------------------------------------------------
// Thrawn — fantasy football trade analyzer (Sleeper leagues)
// ---------------------------------------------------------------------------

/**
 * A Sleeper league the user is tracking. `settings` is a trimmed snapshot of
 * the Sleeper league payload (scoring_settings, roster_positions, num_teams,
 * max_keepers) so valuation is reproducible offline. `myRosterId` marks which
 * roster belongs to the user, driving the trade-target analysis.
 */
export const thrawnLeagues = pgTable(
  "thrawn_leagues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sleeperLeagueId: text("sleeper_league_id").notNull(),
    name: text("name").notNull(),
    season: text("season").notNull(),
    settings: jsonb("settings").$type<ThrawnLeagueSettings>().notNull(),
    myRosterId: integer("my_roster_id"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("thrawn_leagues_user_idx").on(t.userId),
    userLeagueIdx: uniqueIndex("thrawn_leagues_user_league_idx").on(
      t.userId,
      t.sleeperLeagueId
    ),
  })
);

/** Trimmed Sleeper league settings snapshot stored on thrawn_leagues. */
export type ThrawnLeagueSettings = {
  /** Sleeper scoring_settings: stat key -> points per unit. */
  scoring: Record<string, number>;
  /** Sleeper roster_positions, e.g. ["QB","RB","RB","WR","WR","TE","FLEX","FLEX","K","DEF","BN",...]. */
  rosterPositions: string[];
  numTeams: number;
  maxKeepers: number;
};

/**
 * One roster in a tracked league, refreshed on every sync. Player ids are
 * Sleeper player ids (numeric strings, or team abbreviations for DEF).
 */
export const thrawnTeams = pgTable(
  "thrawn_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => thrawnLeagues.id, { onDelete: "cascade" }),
    rosterId: integer("roster_id").notNull(),
    ownerId: text("owner_id"),
    displayName: text("display_name"),
    teamName: text("team_name"),
    avatar: text("avatar"),
    players: jsonb("players").$type<string[]>().notNull().default([]),
    starters: jsonb("starters").$type<string[]>().notNull().default([]),
    keepers: jsonb("keepers").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    leagueIdx: index("thrawn_teams_league_idx").on(t.leagueId),
    leagueRosterIdx: uniqueIndex("thrawn_teams_league_roster_idx").on(
      t.leagueId,
      t.rosterId
    ),
  })
);

/**
 * Trimmed NFL player dictionary from Sleeper's daily players dump. Global
 * (not user-scoped): these are shared facts, and Sleeper asks that the 5MB
 * dump be fetched at most once per day. `id` is the Sleeper player id —
 * numeric string for players, team abbreviation for DEF units.
 */
export const thrawnPlayers = pgTable(
  "thrawn_players",
  {
    id: text("id").primaryKey(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    position: text("position"),
    team: text("team"),
    age: integer("age"),
    status: text("status"),
    injuryStatus: text("injury_status"),
    yearsExp: integer("years_exp"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    positionIdx: index("thrawn_players_position_idx").on(t.position),
  })
);

/**
 * A season-long stat projection for one player from one public source
 * (v1: Sleeper/rotowire). `stats` holds the raw stat-level projection whose
 * keys line up with Sleeper scoring_settings, so league-accurate points are
 * computed at read time. `ptsPpr`/`adpPpr` are denormalized conveniences.
 */
export const thrawnProjections = pgTable(
  "thrawn_projections",
  {
    source: text("source").notNull().default("sleeper"),
    season: text("season").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => thrawnPlayers.id, { onDelete: "cascade" }),
    stats: jsonb("stats").$type<Record<string, number>>().notNull(),
    ptsPpr: doublePrecision("pts_ppr"),
    adpPpr: doublePrecision("adp_ppr"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.source, t.season, t.playerId] }),
    seasonIdx: index("thrawn_projections_season_idx").on(t.season),
  })
);

/**
 * A user's custom projected-points override for one player in one season.
 * Overrides replace the league-scored public projection everywhere in the
 * valuation engine, letting the user play with their own rankings. Keyed per
 * (user, season, player) so an override applies across leagues.
 */
export const thrawnOverrides = pgTable(
  "thrawn_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    season: text("season").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => thrawnPlayers.id, { onDelete: "cascade" }),
    points: doublePrecision("points").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userSeasonPlayerIdx: uniqueIndex("thrawn_overrides_user_season_player_idx").on(
      t.userId,
      t.season,
      t.playerId
    ),
  })
);

export type ThrawnLeague = typeof thrawnLeagues.$inferSelect;
export type NewThrawnLeague = typeof thrawnLeagues.$inferInsert;
export type ThrawnTeam = typeof thrawnTeams.$inferSelect;
export type NewThrawnTeam = typeof thrawnTeams.$inferInsert;
export type ThrawnPlayer = typeof thrawnPlayers.$inferSelect;
export type NewThrawnPlayer = typeof thrawnPlayers.$inferInsert;
export type ThrawnProjection = typeof thrawnProjections.$inferSelect;
export type NewThrawnProjection = typeof thrawnProjections.$inferInsert;
export type ThrawnOverride = typeof thrawnOverrides.$inferSelect;
export type NewThrawnOverride = typeof thrawnOverrides.$inferInsert;

export type LazaxGame = typeof lazaxGames.$inferSelect;
export type NewLazaxGame = typeof lazaxGames.$inferInsert;
export type LazaxPlayer = typeof lazaxPlayers.$inferSelect;
export type NewLazaxPlayer = typeof lazaxPlayers.$inferInsert;
export type LazaxTimeSegment = typeof lazaxTimeSegments.$inferSelect;
export type NewLazaxTimeSegment = typeof lazaxTimeSegments.$inferInsert;

export type LlmCall = typeof llmCalls.$inferSelect;
export type NewLlmCall = typeof llmCalls.$inferInsert;

export type HuntRun = typeof huntRuns.$inferSelect;
export type NewHuntRun = typeof huntRuns.$inferInsert;

export type SearchTarget = typeof searchTargets.$inferSelect;
export type NewSearchTarget = typeof searchTargets.$inferInsert;
export type Search = typeof searches.$inferSelect;
export type NewSearch = typeof searches.$inferInsert;
export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type ListingImage = typeof listingImages.$inferSelect;
export type NewListingImage = typeof listingImages.$inferInsert;
export type Comp = typeof comps.$inferSelect;
export type NewComp = typeof comps.$inferInsert;
export type Evaluation = typeof evaluations.$inferSelect;
export type NewEvaluation = typeof evaluations.$inferInsert;
export type ItemObservation = typeof itemObservations.$inferSelect;
export type NewItemObservation = typeof itemObservations.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type CandidateEvent = typeof candidateEvents.$inferSelect;
export type NewCandidateEvent = typeof candidateEvents.$inferInsert;
export type BrowserAgent = typeof browserAgents.$inferSelect;
export type NewBrowserAgent = typeof browserAgents.$inferInsert;
