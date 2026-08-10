-- 0012_test_script.sql — persist the generated test script + per-case PLM push
-- status so the run detail can rehydrate them (show generated tests, offer
-- regenerate, and mark cases already pushed to the PLM).
--
-- test_script holds { filePath, code, framework }. Per-case push status
-- (plmKey/plmUrl) is stored inside the existing test_cases jsonb entries, so it
-- needs no column of its own.
--
-- Idempotent — safe to re-run. Apply in the Supabase SQL editor before deploying.

ALTER TABLE suggestions
  ADD COLUMN IF NOT EXISTS test_script jsonb;
