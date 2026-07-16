CREATE TABLE IF NOT EXISTS "mp_candidate_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"stage" "mp_candidate_stage" NOT NULL,
	"message" text,
	"detail" jsonb,
	"workflow_id" text,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_candidate_events" ADD CONSTRAINT "mp_candidate_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_candidate_events" ADD CONSTRAINT "mp_candidate_events_candidate_id_mp_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."mp_candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_candidate_events_candidate_idx" ON "mp_candidate_events" USING btree ("candidate_id","created_at");--> statement-breakpoint
ALTER TABLE "mp_candidates" DROP COLUMN IF EXISTS "source_email_id";