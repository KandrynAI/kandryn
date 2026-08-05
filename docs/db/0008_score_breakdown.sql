-- 0008_score_breakdown.sql
-- Per-dimension Synthesis score breakdown + plain-English narrative.
-- Idempotent; apply in the Supabase SQL editor before deploying Prompt B.

ALTER TABLE suggestions
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb;

ALTER TABLE suggestions
  ADD COLUMN IF NOT EXISTS score_narrative text;
