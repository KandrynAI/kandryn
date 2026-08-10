-- 0014_aegis.sql
-- Adds Aegis security scan columns to the runs table.
-- Idempotent. Apply in the Supabase SQL editor before deploying.
--
-- NOTE: numbered 0014 because 0013 is already taken (0013_run_stack.sql).

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS security_scan        jsonb;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS security_scan_status text
    CHECK (security_scan_status IN
      ('pending','running','done','failed','skipped'));

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS security_gate        text
    CHECK (security_gate IN ('approved','blocked','pending'));

CREATE INDEX IF NOT EXISTS runs_security_gate_idx
  ON runs (security_gate)
  WHERE security_gate IS NOT NULL;
