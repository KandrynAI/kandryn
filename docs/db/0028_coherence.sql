-- 0028_coherence.sql
-- Additive, idempotent. Apply in the Supabase SQL editor BEFORE deploying.
--
-- Phase 3: the static coherence check result, persisted per suggestion so
-- Synthesia's ranking, the exclusion rule, and the diff viewer can read it.

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS coherence_score numeric;
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS coherence_status text;      -- passed | warnings | failed
ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS coherence_findings jsonb;
