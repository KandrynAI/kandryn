-- 0032_segregation_of_duties.sql — Governance item 6: second-approver mode.
-- Additive + idempotent. Apply in Supabase before deploying the code.

-- Who approved a parked (awaiting_review) plan, and when — persisted on the run
-- so segregation-of-duties is a durable, checkable fact (not reconstructed from
-- the audit log) and the explanation report can name the approver.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS approved_by_user_id text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- When true, the user who triggered a run may not approve its own parked plan —
-- a different admin must. Default off (opt-in governance control).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS require_second_approver boolean NOT NULL DEFAULT false;
