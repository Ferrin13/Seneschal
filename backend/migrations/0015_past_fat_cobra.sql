-- Collapse pre-existing duplicate observations before enforcing uniqueness.
-- Keeps the most recent row per (user, listing, title, source). Rows with a
-- NULL listing_id or normalized_title can't collide under the unique index
-- (NULLs are distinct), so they're left untouched.
DELETE FROM "mp_item_observations" a
USING (
	SELECT id, row_number() OVER (
		PARTITION BY "user_id", "listing_id", "normalized_title", "source"
		ORDER BY "observed_at" DESC, "id" DESC
	) AS rn
	FROM "mp_item_observations"
	WHERE "listing_id" IS NOT NULL AND "normalized_title" IS NOT NULL
) d
WHERE a."id" = d.id AND d.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_item_observations_uniq_idx" ON "mp_item_observations" USING btree ("user_id","listing_id","normalized_title","source");
