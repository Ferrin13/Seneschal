CREATE TABLE IF NOT EXISTS "thrawn_matchups" (
	"league_id" uuid NOT NULL,
	"season" text NOT NULL,
	"week" integer NOT NULL,
	"roster_id" integer NOT NULL,
	"owner_id" text,
	"matchup_id" integer,
	"points" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thrawn_matchups_league_id_season_week_roster_id_pk" PRIMARY KEY("league_id","season","week","roster_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thrawn_matchups" ADD CONSTRAINT "thrawn_matchups_league_id_thrawn_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."thrawn_leagues"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thrawn_matchups_league_season_idx" ON "thrawn_matchups" USING btree ("league_id","season");