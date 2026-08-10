CREATE TABLE IF NOT EXISTS "thrawn_leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sleeper_league_id" text NOT NULL,
	"name" text NOT NULL,
	"season" text NOT NULL,
	"settings" jsonb NOT NULL,
	"my_roster_id" integer,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thrawn_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"season" text NOT NULL,
	"player_id" text NOT NULL,
	"points" double precision NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thrawn_players" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"position" text,
	"team" text,
	"age" integer,
	"status" text,
	"injury_status" text,
	"years_exp" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thrawn_projections" (
	"source" text DEFAULT 'sleeper' NOT NULL,
	"season" text NOT NULL,
	"player_id" text NOT NULL,
	"stats" jsonb NOT NULL,
	"pts_ppr" double precision,
	"adp_ppr" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thrawn_projections_source_season_player_id_pk" PRIMARY KEY("source","season","player_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thrawn_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"roster_id" integer NOT NULL,
	"owner_id" text,
	"display_name" text,
	"team_name" text,
	"avatar" text,
	"players" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keepers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thrawn_leagues" ADD CONSTRAINT "thrawn_leagues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thrawn_overrides" ADD CONSTRAINT "thrawn_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thrawn_overrides" ADD CONSTRAINT "thrawn_overrides_player_id_thrawn_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."thrawn_players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thrawn_projections" ADD CONSTRAINT "thrawn_projections_player_id_thrawn_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."thrawn_players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thrawn_teams" ADD CONSTRAINT "thrawn_teams_league_id_thrawn_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."thrawn_leagues"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thrawn_leagues_user_idx" ON "thrawn_leagues" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thrawn_leagues_user_league_idx" ON "thrawn_leagues" USING btree ("user_id","sleeper_league_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thrawn_overrides_user_season_player_idx" ON "thrawn_overrides" USING btree ("user_id","season","player_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thrawn_players_position_idx" ON "thrawn_players" USING btree ("position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thrawn_projections_season_idx" ON "thrawn_projections" USING btree ("season");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thrawn_teams_league_idx" ON "thrawn_teams" USING btree ("league_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thrawn_teams_league_roster_idx" ON "thrawn_teams" USING btree ("league_id","roster_id");