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
