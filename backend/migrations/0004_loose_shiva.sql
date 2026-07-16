CREATE TYPE "public"."mp_agent_status" AS ENUM('online', 'offline', 'needs_login');--> statement-breakpoint
CREATE TYPE "public"."mp_comp_source" AS ENUM('ebay', 'craigslist', 'internal');--> statement-breakpoint
CREATE TYPE "public"."mp_evaluation_tier" AS ENUM('triage', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."mp_evaluation_verdict" AS ENUM('good_deal', 'pass', 'unsure');--> statement-breakpoint
CREATE TYPE "public"."mp_notification_status" AS ENUM('new', 'seen', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."mp_scrape_job_status" AS ENUM('pending', 'claimed', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mp_scrape_status" AS ENUM('ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mp_search_source" AS ENUM('llm', 'user');--> statement-breakpoint
CREATE TYPE "public"."mp_triage_status" AS ENUM('pending', 'promising', 'rejected', 'skipped');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_alert_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"search_id" uuid,
	"subject" text,
	"from_address" text,
	"received_at" timestamp with time zone,
	"raw_key" text,
	"parsed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_browser_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "mp_agent_status" DEFAULT 'offline' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"needs_login_since" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"search_id" uuid,
	"source_email_id" uuid,
	"fb_item_id" text,
	"listing_url" text NOT NULL,
	"title" text,
	"thumbnail_url" text,
	"price_cents" integer,
	"blurb" text,
	"dedupe_key" text NOT NULL,
	"triage_status" "mp_triage_status" DEFAULT 'pending' NOT NULL,
	"triage_score" integer,
	"triage_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_comps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"source" "mp_comp_source" NOT NULL,
	"matched_title" text,
	"price_cents" integer,
	"currency" text,
	"url" text,
	"sold_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"candidate_id" uuid,
	"listing_id" uuid,
	"tier" "mp_evaluation_tier" NOT NULL,
	"model" text,
	"verdict" "mp_evaluation_verdict",
	"confidence" double precision,
	"estimated_value_cents" integer,
	"rationale" text,
	"prompt_version" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_item_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text,
	"normalized_title" text,
	"price_cents" integer,
	"currency" text,
	"source" "mp_comp_source" DEFAULT 'internal' NOT NULL,
	"listing_id" uuid,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_listing_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"source_url" text,
	"image_key" text,
	"width" integer,
	"height" integer,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"candidate_id" uuid,
	"fb_item_id" text,
	"url" text NOT NULL,
	"title" text,
	"description" text,
	"price_cents" integer,
	"currency" text,
	"condition_code" text,
	"condition_label" text,
	"category_id" text,
	"category_path" jsonb,
	"location_text" text,
	"latitude" double precision,
	"longitude" double precision,
	"seller_id" text,
	"seller_name" text,
	"seller_profile_url" text,
	"seller_rating_average" double precision,
	"seller_rating_count" integer,
	"availability_status" text,
	"is_sold" boolean,
	"is_pending" boolean,
	"listed_at" timestamp with time zone,
	"raw_extract" jsonb,
	"html_key" text,
	"scrape_status" "mp_scrape_status" DEFAULT 'ok' NOT NULL,
	"scrape_error" text,
	"scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid,
	"evaluation_id" uuid,
	"kind" text DEFAULT 'deal' NOT NULL,
	"title" text,
	"body" text,
	"status" "mp_notification_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_scrape_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" "mp_scrape_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"agent_id" text,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_search_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"eval_instructions" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"query" text NOT NULL,
	"filters" jsonb,
	"fb_search_url" text,
	"source" "mp_search_source" DEFAULT 'llm' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_alert_emails" ADD CONSTRAINT "mp_alert_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_alert_emails" ADD CONSTRAINT "mp_alert_emails_search_id_mp_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."mp_searches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_browser_agents" ADD CONSTRAINT "mp_browser_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_candidates" ADD CONSTRAINT "mp_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_candidates" ADD CONSTRAINT "mp_candidates_search_id_mp_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."mp_searches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_candidates" ADD CONSTRAINT "mp_candidates_source_email_id_mp_alert_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."mp_alert_emails"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_comps" ADD CONSTRAINT "mp_comps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_comps" ADD CONSTRAINT "mp_comps_listing_id_mp_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mp_listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_evaluations" ADD CONSTRAINT "mp_evaluations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_evaluations" ADD CONSTRAINT "mp_evaluations_candidate_id_mp_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."mp_candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_evaluations" ADD CONSTRAINT "mp_evaluations_listing_id_mp_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mp_listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_item_observations" ADD CONSTRAINT "mp_item_observations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_item_observations" ADD CONSTRAINT "mp_item_observations_listing_id_mp_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mp_listings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_listing_images" ADD CONSTRAINT "mp_listing_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_listing_images" ADD CONSTRAINT "mp_listing_images_listing_id_mp_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mp_listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_listings" ADD CONSTRAINT "mp_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_listings" ADD CONSTRAINT "mp_listings_candidate_id_mp_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."mp_candidates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_notifications" ADD CONSTRAINT "mp_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_notifications" ADD CONSTRAINT "mp_notifications_listing_id_mp_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mp_listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_notifications" ADD CONSTRAINT "mp_notifications_evaluation_id_mp_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."mp_evaluations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_scrape_jobs" ADD CONSTRAINT "mp_scrape_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_scrape_jobs" ADD CONSTRAINT "mp_scrape_jobs_candidate_id_mp_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."mp_candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_search_targets" ADD CONSTRAINT "mp_search_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_searches" ADD CONSTRAINT "mp_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_searches" ADD CONSTRAINT "mp_searches_target_id_mp_search_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."mp_search_targets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_alert_emails_user_idx" ON "mp_alert_emails" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_alert_emails_gmail_id_idx" ON "mp_alert_emails" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_browser_agents_user_name_idx" ON "mp_browser_agents" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_candidates_user_idx" ON "mp_candidates" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_candidates_user_dedupe_idx" ON "mp_candidates" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_candidates_triage_idx" ON "mp_candidates" USING btree ("user_id","triage_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_comps_listing_idx" ON "mp_comps" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_evaluations_user_idx" ON "mp_evaluations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_evaluations_candidate_idx" ON "mp_evaluations" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_evaluations_listing_idx" ON "mp_evaluations" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_item_observations_user_idx" ON "mp_item_observations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_item_observations_title_idx" ON "mp_item_observations" USING btree ("user_id","normalized_title");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_listing_images_listing_idx" ON "mp_listing_images" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_listings_user_idx" ON "mp_listings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_listings_user_item_idx" ON "mp_listings" USING btree ("user_id","fb_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_listings_candidate_idx" ON "mp_listings" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_notifications_user_status_idx" ON "mp_notifications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_scrape_jobs_status_idx" ON "mp_scrape_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_scrape_jobs_candidate_idx" ON "mp_scrape_jobs" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_search_targets_user_idx" ON "mp_search_targets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_searches_user_idx" ON "mp_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_searches_target_idx" ON "mp_searches" USING btree ("target_id");