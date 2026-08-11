CREATE TABLE IF NOT EXISTS "thrawn_player_stats" (
	"season" text NOT NULL,
	"player_id" text NOT NULL,
	"stats" jsonb NOT NULL,
	"gp" integer DEFAULT 0 NOT NULL,
	"pts_ppr" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thrawn_player_stats_season_player_id_pk" PRIMARY KEY("season","player_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thrawn_player_stats" ADD CONSTRAINT "thrawn_player_stats_player_id_thrawn_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."thrawn_players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thrawn_player_stats_player_idx" ON "thrawn_player_stats" USING btree ("player_id");