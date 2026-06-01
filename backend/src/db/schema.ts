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
