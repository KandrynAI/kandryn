-- 0009_veria_review.sql
-- Adds Veria review columns to the runs table.
-- Idempotent: safe to run multiple times.

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS review        jsonb;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS review_status text
    CHECK (review_status IN ('pending', 'running', 'done', 'failed'));

-- Index for querying runs by review status
CREATE INDEX IF NOT EXISTS runs_review_status_idx
  ON runs (review_status)
  WHERE review_status IS NOT NULL;
