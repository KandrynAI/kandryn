-- 0024_suggestion_file_diff.sql
-- Additive, idempotent. Apply in the Supabase SQL editor BEFORE deploying.
--
-- Phase 1 PR2: store a structured, server-computed diff per suggestion file so
-- the diff viewer never needs the original file content client-side. Null for a
-- file that failed to apply. lines_added / lines_removed (from 0022) are now
-- computed accurately from the diff.

ALTER TABLE suggestion_files ADD COLUMN IF NOT EXISTS diff jsonb;
