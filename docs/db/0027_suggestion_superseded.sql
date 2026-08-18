-- 0027_suggestion_superseded.sql
-- Additive, idempotent. Apply in the Supabase SQL editor BEFORE deploying.
--
-- Phase 2 PR3 (plan editing): editing a plan writes a new revision and
-- regenerates. The prior revision's suggestions are marked superseded (retained,
-- not deleted) so the earlier revision stays readable; the run detail shows only
-- non-superseded suggestions.

ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false;
