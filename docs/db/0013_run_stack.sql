-- 0013_run_stack.sql
-- Records which stack profile was used for a run (stack-aware AI generation).
-- Idempotent — safe to re-run. Apply in the Supabase SQL editor before deploy.
--
-- NOTE: 0012 is already taken by 0012_test_script.sql; this is the next number.

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS stack_desc text;

COMMENT ON COLUMN runs.stack_desc IS
  'Human-readable stack used for this run, e.g. react · nodejs · postgresql';
