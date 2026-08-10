-- 0015_narratia.sql
-- Adds Narratia runbook columns to the runs table.
-- Idempotent. Apply in the Supabase SQL editor before deploying.
--
-- NOTE: numbered 0015 because 0014 is already taken (0014_aegis.sql).

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS runbook           text;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS runbook_status    text
    CHECK (runbook_status IN ('pending','running','done','failed'));

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS runbook_target    text;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS runbook_url       text;
