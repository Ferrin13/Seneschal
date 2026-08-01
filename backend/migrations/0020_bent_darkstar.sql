CREATE TYPE "public"."lazax_action_state" AS ENUM('ready', 'exhausted', 'passed');--> statement-breakpoint
CREATE TYPE "public"."lazax_clock_state" AS ENUM('running', 'paused');--> statement-breakpoint
CREATE TYPE "public"."lazax_game_status" AS ENUM('setup', 'active', 'finished');--> statement-breakpoint
CREATE TYPE "public"."lazax_phase" AS ENUM('strategy', 'action', 'status', 'agenda');--> statement-breakpoint
CREATE TYPE "public"."lazax_segment_kind" AS ENUM('player', 'general');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lazax_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text DEFAULT 'Twilight Imperium' NOT NULL,
	"status" "lazax_game_status" DEFAULT 'setup' NOT NULL,
	"phase" "lazax_phase" DEFAULT 'strategy' NOT NULL,
	"round_number" integer DEFAULT 1 NOT NULL,
	"speaker_player_id" uuid,
	"active_player_id" uuid,
	"clock_state" "lazax_clock_state" DEFAULT 'paused' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lazax_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"faction_id" text NOT NULL,
	"seat_index" integer NOT NULL,
	"strategy_card" integer,
	"action_state" "lazax_action_state" DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lazax_players_seat_nonneg" CHECK ("lazax_players"."seat_index" >= 0),
	CONSTRAINT "lazax_players_strategy_card_range" CHECK ("lazax_players"."strategy_card" IS NULL OR ("lazax_players"."strategy_card" >= 1 AND "lazax_players"."strategy_card" <= 8))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lazax_time_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid,
	"kind" "lazax_segment_kind" NOT NULL,
	"phase" "lazax_phase" NOT NULL,
	"round_number" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lazax_games" ADD CONSTRAINT "lazax_games_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lazax_players" ADD CONSTRAINT "lazax_players_game_id_lazax_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."lazax_games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lazax_time_segments" ADD CONSTRAINT "lazax_time_segments_game_id_lazax_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."lazax_games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lazax_time_segments" ADD CONSTRAINT "lazax_time_segments_player_id_lazax_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."lazax_players"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lazax_games_owner_idx" ON "lazax_games" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lazax_games_owner_updated_idx" ON "lazax_games" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lazax_players_game_idx" ON "lazax_players" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lazax_players_game_seat_idx" ON "lazax_players" USING btree ("game_id","seat_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lazax_players_game_faction_idx" ON "lazax_players" USING btree ("game_id","faction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lazax_time_segments_game_idx" ON "lazax_time_segments" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lazax_time_segments_game_started_idx" ON "lazax_time_segments" USING btree ("game_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lazax_time_segments_open_idx" ON "lazax_time_segments" USING btree ("game_id","ended_at");