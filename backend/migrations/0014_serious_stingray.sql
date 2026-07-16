CREATE TYPE "public"."mp_disposition" AS ENUM('none', 'not_a_fit', 'not_a_good_deal', 'keep_watching', 'reached_out', 'sold');--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "disposition" "mp_disposition" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "disposition_note" text;--> statement-breakpoint
ALTER TABLE "mp_candidates" ADD COLUMN "disposition_at" timestamp with time zone;