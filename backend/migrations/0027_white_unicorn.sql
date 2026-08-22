ALTER TYPE "public"."mp_llm_purpose" ADD VALUE 'voice' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."mp_llm_purpose" ADD VALUE 'stt' BEFORE 'other';--> statement-breakpoint
ALTER TABLE "mp_llm_calls" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "mp_llm_calls" ADD COLUMN "status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_llm_calls" ADD COLUMN "error_message" text;