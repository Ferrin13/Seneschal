CREATE TYPE "public"."mp_candidate_stage" AS ENUM('discovered', 'triaged', 'deep_scraped', 'comps_gathered', 'evaluated', 'sold', 'disappeared', 'error');--> statement-breakpoint
CREATE TYPE "public"."mp_candidate_status" AS ENUM('active', 'sold', 'disappeared');--> statement-breakpoint
CREATE TYPE "public"."mp_platform" AS ENUM('facebook', 'craigslist');--> statement-breakpoint
ALTER TYPE "public"."mp_comp_source" ADD VALUE 'web';--> statement-breakpoint
ALTER TABLE "mp_alert_emails" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "mp_alert_emails" CASCADE;--> statement-breakpoint
ALTER TABLE "mp_candidates" DROP CONSTRAINT IF EXISTS "mp_candidates_source_email_id_mp_alert_emails_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "mp_listings_user_item_idx";--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "platform" "mp_platform" DEFAULT 'facebook' NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "promise_score" integer;--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "status" "mp_candidate_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "source_listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "missed_runs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_listings" ADD COLUMN "platform" "mp_platform" DEFAULT 'facebook' NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_listings" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mp_listings" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_listings" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_listings" ADD COLUMN "disappeared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mp_searches" ADD COLUMN "platform" "mp_platform" DEFAULT 'facebook' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_candidates_promise_idx" ON "mp_candidates" USING btree ("user_id","promise_score");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_listings_user_item_idx" ON "mp_listings" USING btree ("user_id","platform","fb_item_id");