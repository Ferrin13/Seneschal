import { eq } from "drizzle-orm";
import type { DbClient } from "./client.js";
import { activities, categories } from "./schema.js";

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
 * Idempotent: if the user already has any categories we assume they've been
 * seeded (or have edited their list) and do nothing. Safe to call from /me
 * on every request without measurable cost.
 */
export async function seedUserDefaults(
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
