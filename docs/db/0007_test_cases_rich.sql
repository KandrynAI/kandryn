-- 0007_test_cases_rich.sql
-- Rich, AC-driven test cases persisted on the committed suggestion.
-- Idempotent; apply in the Supabase SQL editor before deploying Prompt A.

ALTER TABLE suggestions
  ADD COLUMN IF NOT EXISTS test_cases jsonb NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS suggestions_test_cases_idx
  ON suggestions USING gin(test_cases);
