CREATE TABLE IF NOT EXISTS "thrawn_season_teams" (
	"league_id" uuid NOT NULL,
	"season" text NOT NULL,
	"roster_id" integer NOT NULL,
	"owner_id" text,
	"display_name" text,
	"team_name" text,
	"avatar" text,
	"players" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thrawn_season_teams_league_id_season_roster_id_pk" PRIMARY KEY("league_id","season","roster_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thrawn_season_teams" ADD CONSTRAINT "thrawn_season_teams_league_id_thrawn_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."thrawn_leagues"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
