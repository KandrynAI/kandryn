-- 0016_aegis_remediation.sql
-- Tracks remediation state: a remediation run links back to the run that
-- produced the Aegis finding. Idempotent. Apply in Supabase before deploying.
--
-- NOTE: numbered 0016 because 0015 is already taken (0015_narratia.sql).

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS parent_run_id   integer
    REFERENCES runs(id) ON DELETE SET NULL;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS trigger_context text;

COMMENT ON COLUMN runs.parent_run_id IS
  'For remediation runs: the run that produced the Aegis finding';

COMMENT ON COLUMN runs.trigger_context IS
  'Additional trigger context: manual|scheduled|remediation|breakdown';

CREATE INDEX IF NOT EXISTS runs_parent_run_id_idx
  ON runs (parent_run_id)
  WHERE parent_run_id IS NOT NULL;
