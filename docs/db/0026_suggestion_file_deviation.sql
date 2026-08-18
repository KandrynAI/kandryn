-- 0026_suggestion_file_deviation.sql
-- Additive, idempotent. Apply in the Supabase SQL editor BEFORE deploying.
--
-- Phase 2 PR2 (multi-file generation): capture when a generated file falls
-- outside the change plan. Populated only for deviation files; null otherwise.
-- Not scored in this phase — captured so the data exists for later analysis.

ALTER TABLE suggestion_files ADD COLUMN IF NOT EXISTS deviation_reason text;
