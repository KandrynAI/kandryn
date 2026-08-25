-- 0031_audit_retention_override.sql — Governance item 5: per-team audit retention.
-- Additive + idempotent. Apply in Supabase before deploying the code that reads
-- this column.

-- Per-team audit-log retention, in days. NULL = fall back to the plan default
-- (AUDIT_RETENTION_DAYS). Lets regulated customers retain audit history well
-- beyond the plan tiers (e.g. multi-year).
ALTER TABLE teams ADD COLUMN IF NOT EXISTS audit_retention_days integer;
