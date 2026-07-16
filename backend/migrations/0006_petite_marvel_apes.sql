CREATE TYPE "public"."mp_scrape_job_kind" AS ENUM('listing', 'search');--> statement-breakpoint
ALTER TABLE "mp_scrape_jobs" ALTER COLUMN "candidate_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_scrape_jobs" ADD COLUMN "kind" "mp_scrape_job_kind" DEFAULT 'listing' NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_scrape_jobs" ADD COLUMN "search_id" uuid;--> statement-breakpoint
ALTER TABLE "mp_scrape_jobs" ADD COLUMN "search_url" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_scrape_jobs" ADD CONSTRAINT "mp_scrape_jobs_search_id_mp_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."mp_searches"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
