CREATE TYPE "public"."mp_llm_purpose" AS ENUM('search_expansion', 'triage', 'advanced', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "mp_llm_purpose" NOT NULL,
	"provider" text DEFAULT 'openrouter' NOT NULL,
	"model" text NOT NULL,
	"request_id" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"cost_usd" double precision,
	"candidate_id" uuid,
	"listing_id" uuid,
	"target_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_llm_calls" ADD CONSTRAINT "mp_llm_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_llm_calls" ADD CONSTRAINT "mp_llm_calls_candidate_id_mp_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."mp_candidates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_llm_calls" ADD CONSTRAINT "mp_llm_calls_listing_id_mp_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."mp_listings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_llm_calls" ADD CONSTRAINT "mp_llm_calls_target_id_mp_search_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."mp_search_targets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_llm_calls_user_idx" ON "mp_llm_calls" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_llm_calls_model_idx" ON "mp_llm_calls" USING btree ("user_id","model");