DROP INDEX IF EXISTS "expenses_user_occurred_idx";--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "occurred_on";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "occurred_at" timestamp with time zone NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_user_occurred_idx" ON "expenses" USING btree ("user_id","occurred_at");
