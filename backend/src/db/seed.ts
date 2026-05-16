import { eq } from "drizzle-orm";
import type { DbClient } from "./client.js";
import { activities, businesses, categories } from "./schema.js";

/**
 * Pre-populated business list. Modeled as a per-user table (not a Postgres
 * enum) so it's editable via SQL, but for v1 the app treats it as a fixed
 * enum — there's no UI to add or rename entries.
 */
export const SEED_BUSINESSES: string[] = [
  "Parthadae Software",
  "Parthadae Properties",
  "Boise Bounce",
  "Gem State Brief",
  "BRC Bid Portal",
];

/**
 * Per-user seed data. Called once on first sign-in (lazy upsert in /me).
 * Categories use the user's exact spec wording; the `kind` enum drives
 * category-level aggregation regardless of name.
 */
type SeedCategory = {
  name: string;
  kind:
    | "good"
    | "necessary_good"
    | "necessary_inconvenient"
    | "good_entertainment"
    | "not_best"
    | "waste"
    | "spiritual";
  color: string;
  activities: string[];
};

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    name: "Good Usages of Time",
    kind: "good",
    color: "#2E7D32", // deep green
    activities: [
      "Helping Others",
      "Seeing Hope",
      "Productive Project",
      "Home Improvement",
      "Youtube - Educational",
    ],
  },
  {
    name: "Necessary but Good",
    kind: "necessary_good",
    color: "#558B2F", // olive green
    activities: [
      "Working Out",
      "Sleeping",
      "Napping",
      "Re-sleep",
      "Personal Care",
      "Walking",
    ],
  },
  {
    name: "Necessary but Inconvenient",
    kind: "necessary_inconvenient",
    color: "#EF6C00", // orange
    activities: [
      "Administrative",
      "Shopping",
      "Driving",
      "Cooking/Food Prep",
      "Chores",
      "Working",
    ],
  },
  {
    name: "Good Entertainment",
    kind: "good_entertainment",
    color: "#1565C0", // blue
    activities: [
      "Social",
      "Fun Project",
      "Reading",
      "Volleyball",
      "Ultimate",
      "Board Games",
      "Active Activity",
      "Discord Gaming/Hanging Out",
    ],
  },
  {
    name: "Not Best Usage of Time",
    kind: "not_best",
    color: "#C62828", // red
    activities: [
      "Youtube - Entertainment",
      "Misc Entertainment",
      "Watching Sports",
      "Solo Gaming",
    ],
  },
  {
    name: "Waste",
    kind: "waste",
    color: "#37474F", // slate
    activities: ["Attempted Sleep", "Attempted Napping"],
  },
  {
    name: "Specifically Spiritual",
    kind: "spiritual",
    color: "#6A1B9A", // purple
    activities: [
      "Church",
      "Bible Reading",
      "Bible Study",
      "Misc Spiritual",
    ],
  },
];

/**
 * Idempotent: each subsection guards on whether its own seed data is
 * already present, so adding a new seed (e.g. businesses) to an account
 * created before that seed existed will still backfill on the next
 * sign-in. Safe to call from /me on every request.
 */
export async function seedUserDefaults(
  db: DbClient,
  userId: string
): Promise<void> {
  await seedCategoriesAndActivities(db, userId);
  await seedBusinesses(db, userId);
}

async function seedCategoriesAndActivities(
  db: DbClient,
  userId: string
): Promise<void> {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, userId))
    .limit(1);
  if (existing.length > 0) return;

  await db.transaction(async (tx) => {
    for (let ci = 0; ci < SEED_CATEGORIES.length; ci++) {
      const cat = SEED_CATEGORIES[ci]!;
      const [inserted] = await tx
        .insert(categories)
        .values({
          userId,
          name: cat.name,
          kind: cat.kind,
          color: cat.color,
          sortOrder: ci,
        })
        .returning({ id: categories.id });

      const categoryId = inserted!.id;
      const rows = cat.activities.map((name, ai) => ({
        userId,
        categoryId,
        name,
        sortOrder: ai,
      }));
      if (rows.length > 0) {
        await tx.insert(activities).values(rows);
      }
    }
  });
}

async function seedBusinesses(db: DbClient, userId: string): Promise<void> {
  const existing = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.userId, userId))
    .limit(1);
  if (existing.length > 0) return;

  const rows = SEED_BUSINESSES.map((name, i) => ({
    userId,
    name,
    sortOrder: i,
  }));
  if (rows.length > 0) {
    await db.insert(businesses).values(rows);
  }
}
