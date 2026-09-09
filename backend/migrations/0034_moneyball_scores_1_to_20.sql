-- Moneyball moves from a 1-10 to a 1-20 rating scale. Double every stored
-- score so existing ratings keep their meaning (8 -> 16, 10 -> 20, 3 -> 6).
-- `scores` is a jsonb object of stat key -> integer; only the values change.
--
-- Guarded so a re-run (or a DB that already holds 1-20 scores) is a no-op:
-- a value above 10 can only exist on the new scale, so if any row has one
-- the table has already been converted.
UPDATE "moneyball_ratings" r
SET "scores" = (
  SELECT COALESCE(jsonb_object_agg(e.key, to_jsonb((e.value)::int * 2)), '{}'::jsonb)
  FROM jsonb_each_text(r."scores") AS e
)
WHERE NOT EXISTS (
  SELECT 1
  FROM "moneyball_ratings" x, jsonb_each_text(x."scores") AS ex
  WHERE (ex.value)::int > 10
);
