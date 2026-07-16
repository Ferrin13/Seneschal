ALTER TABLE "mp_evaluations" ADD COLUMN "value_score" integer;--> statement-breakpoint
ALTER TABLE "mp_evaluations" ADD COLUMN "fit_score" integer;--> statement-breakpoint
-- Backfill numeric scores from the legacy verdict/confidence so existing
-- evaluations render under the new value/fit model.
UPDATE "mp_evaluations"
SET "value_score" = CASE "verdict"
  WHEN 'good_deal' THEN 80
  WHEN 'unsure' THEN 50
  WHEN 'pass' THEN 15
END
WHERE "value_score" IS NULL AND "verdict" IS NOT NULL;--> statement-breakpoint
-- Triage-tier rows scored fit directly; seed fit_score from their confidence.
UPDATE "mp_evaluations"
SET "fit_score" = ROUND("confidence" * 100)
WHERE "fit_score" IS NULL AND "tier" = 'triage' AND "confidence" IS NOT NULL;