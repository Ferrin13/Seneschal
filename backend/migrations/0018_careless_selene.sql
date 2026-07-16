CREATE TYPE "public"."mp_comp_condition" AS ENUM('new', 'used');--> statement-breakpoint
ALTER TABLE "mp_comps" ADD COLUMN "condition" "mp_comp_condition";