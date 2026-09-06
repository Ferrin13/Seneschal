CREATE TABLE IF NOT EXISTS "descartes_beliefs" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"confidence" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"x" double precision,
	"y" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "descartes_beliefs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "descartes_beliefs_confidence_range" CHECK ("descartes_beliefs"."confidence" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "descartes_cluster_members" (
	"user_id" uuid NOT NULL,
	"cluster_id" text NOT NULL,
	"belief_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "descartes_cluster_members_user_id_cluster_id_belief_id_pk" PRIMARY KEY("user_id","cluster_id","belief_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "descartes_clusters" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"description" text,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "descartes_clusters_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "descartes_relations" (
	"user_id" uuid NOT NULL,
	"id" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "descartes_relations_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "descartes_beliefs" ADD CONSTRAINT "descartes_beliefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "descartes_cluster_members" ADD CONSTRAINT "descartes_cluster_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "descartes_cluster_members" ADD CONSTRAINT "descartes_cluster_members_cluster_fk" FOREIGN KEY ("user_id","cluster_id") REFERENCES "public"."descartes_clusters"("user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "descartes_cluster_members" ADD CONSTRAINT "descartes_cluster_members_belief_fk" FOREIGN KEY ("user_id","belief_id") REFERENCES "public"."descartes_beliefs"("user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "descartes_clusters" ADD CONSTRAINT "descartes_clusters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "descartes_relations" ADD CONSTRAINT "descartes_relations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "descartes_relations" ADD CONSTRAINT "descartes_relations_source_fk" FOREIGN KEY ("user_id","source_id") REFERENCES "public"."descartes_beliefs"("user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "descartes_relations" ADD CONSTRAINT "descartes_relations_target_fk" FOREIGN KEY ("user_id","target_id") REFERENCES "public"."descartes_beliefs"("user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "descartes_relations_pair_idx" ON "descartes_relations" USING btree ("user_id","source_id","target_id");