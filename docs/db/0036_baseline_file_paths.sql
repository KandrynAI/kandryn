-- Kandryn — persist a baseline scan's ordered file list  (migration 0036)
--
-- A batch request's custom_id is `f<index>` into the list of files discovered
-- when the scan was submitted. Collection happens minutes to an hour later, in
-- a different process, and it re-derived that list from the repository as it
-- stood AT THAT MOMENT.
--
-- Any push to the default branch in between shifts every index past the change
-- — and a push also triggers a Graphify re-index, so the graph-derived list
-- moves too. The result was silent misattribution: a real finding pointed at
-- whichever file had drifted into its slot. For a security report that is worse
-- than no finding at all.
--
-- The list the batch was built against is now frozen on the scan row, so an
-- index always resolves to the file that was actually scanned.
--
-- Idempotent. Safe to re-run.

ALTER TABLE baseline_scans
  ADD COLUMN IF NOT EXISTS file_paths jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN baseline_scans.file_paths IS
  'Ordered file list the batch was built from; custom_id f<i> indexes into it. Frozen at submit — never recomputed.';
