-- Kandryn — record which model a baseline scan ran on  (migration 0037)
--
-- Aegis and the baseline scan both default to claude-fable-5. That model is a
-- Covered Model: it requires 30-day data retention, and an Anthropic
-- organisation configured for zero data retention is refused with a 400 on
-- every request to it. Regulated customers are the most likely to hold exactly
-- that configuration, so both paths now fall back to claude-opus-5, which is
-- not retention-gated and carries elevated cybersecurity safeguards.
--
-- The fallback must never be silent. A security finding is evidence, and
-- evidence is only as good as the record of what produced it, so the model a
-- scan actually ran on is stored alongside its findings.
--
-- Null means the scan predates this column, not that no model was used. The
-- runtime scan needs no migration — its equivalent field lives inside the
-- existing runs.security_scan jsonb.
--
-- Idempotent. Safe to re-run, and independent of 0036.

ALTER TABLE baseline_scans
  ADD COLUMN IF NOT EXISTS model text;

COMMENT ON COLUMN baseline_scans.model IS
  'Anthropic model this scan''s batch was submitted on. Usually the default; claude-opus-5 when the organisation''s data retention put the Covered Model out of reach. Null for scans predating 0037.';
