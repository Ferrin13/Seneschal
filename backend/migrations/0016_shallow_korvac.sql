CREATE TYPE "public"."mp_hunt_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_hunt_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_id" uuid,
	"workflow_id" text NOT NULL,
	"run_id" text NOT NULL,
	"status" "mp_hunt_run_status" DEFAULT 'running' NOT NULL,
	"searches" integer DEFAULT 0 NOT NULL,
	"discovered" integer DEFAULT 0 NOT NULL,
	"triaged" integer DEFAULT 0 NOT NULL,
	"promising" integer DEFAULT 0 NOT NULL,
	"evaluated" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mp_llm_calls" ADD COLUMN "run_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_hunt_runs" ADD CONSTRAINT "mp_hunt_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_hunt_runs" ADD CONSTRAINT "mp_hunt_runs_target_id_mp_search_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."mp_search_targets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_hunt_runs_user_started_idx" ON "mp_hunt_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_hunt_runs_target_idx" ON "mp_hunt_runs" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_hunt_runs_run_idx" ON "mp_hunt_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_llm_calls_run_idx" ON "mp_llm_calls" USING btree ("run_id");