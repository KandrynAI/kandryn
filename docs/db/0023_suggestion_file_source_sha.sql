-- 0023_suggestion_file_source_sha.sql
-- Additive, idempotent. Apply in the Supabase SQL editor BEFORE deploying.
--
-- Phase 1 (operation-based edits): record the Git blob SHA of the source file
-- read when an edit/delete was resolved, so a branch that moved mid-run can be
-- detected before commit. `hunks` (added in 0022) now holds the edit's
-- search/replace pairs. Null for create.

ALTER TABLE suggestion_files ADD COLUMN IF NOT EXISTS source_blob_sha text;
