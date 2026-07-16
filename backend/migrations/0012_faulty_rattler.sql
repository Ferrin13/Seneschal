CREATE TABLE IF NOT EXISTS "mp_evaluation_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"evaluation_id" uuid,
	"fit_accuracy" integer,
	"fit_note" text,
	"value_accuracy" integer,
	"value_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mp_evaluation_ratings_fit_accuracy_check" CHECK ("mp_evaluation_ratings"."fit_accuracy" IS NULL OR ("mp_evaluation_ratings"."fit_accuracy" BETWEEN 1 AND 10)),
	CONSTRAINT "mp_evaluation_ratings_value_accuracy_check" CHECK ("mp_evaluation_ratings"."value_accuracy" IS NULL OR ("mp_evaluation_ratings"."value_accuracy" BETWEEN 1 AND 10))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_evaluation_ratings" ADD CONSTRAINT "mp_evaluation_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_evaluation_ratings" ADD CONSTRAINT "mp_evaluation_ratings_candidate_id_mp_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."mp_candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_evaluation_ratings" ADD CONSTRAINT "mp_evaluation_ratings_evaluation_id_mp_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."mp_evaluations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_evaluation_ratings_user_candidate_idx" ON "mp_evaluation_ratings" USING btree ("user_id","candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mp_evaluation_ratings_candidate_idx" ON "mp_evaluation_ratings" USING btree ("candidate_id");