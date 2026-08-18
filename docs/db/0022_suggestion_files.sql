-- 0022_suggestion_files.sql
-- Additive + backfill, idempotent. Apply in the Supabase SQL editor BEFORE
-- deploying.
--
-- Phase 0 of multi-file suggestions: move a suggestion's change set into a
-- suggestion_files table (one row per file). Generation is unchanged, so every
-- suggestion still has exactly one file. suggestions.code / file_path are kept
-- (nullable, deprecated) for rollback safety and are no longer written.

CREATE TABLE IF NOT EXISTS suggestion_files (
  id serial PRIMARY KEY,
  suggestion_id integer NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  op text NOT NULL,
  file_path text NOT NULL,
  content text NOT NULL,
  hunks jsonb,
  resolved boolean NOT NULL DEFAULT false,
  apply_status text NOT NULL DEFAULT 'pending',
  apply_error text,
  lines_added integer NOT NULL DEFAULT 0,
  lines_removed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS suggestion_files_suggestion_seq_idx
  ON suggestion_files (suggestion_id, seq);
CREATE INDEX IF NOT EXISTS suggestion_files_suggestion_id_idx
  ON suggestion_files (suggestion_id);

-- Backfill one row per existing suggestion from the deprecated scalar columns.
-- op='create', seq=0, already applied. Skip any suggestion already backfilled.
INSERT INTO suggestion_files
  (suggestion_id, seq, op, file_path, content, resolved, apply_status,
   lines_added, lines_removed)
SELECT s.id, 0, 'create',
       COALESCE(s.file_path, ''),
       COALESCE(s.code, ''),
       true, 'applied',
       CASE WHEN s.code IS NULL OR s.code = '' THEN 0
            ELSE array_length(string_to_array(s.code, E'\n'), 1) END,
       0
FROM suggestions s
WHERE NOT EXISTS (
  SELECT 1 FROM suggestion_files f WHERE f.suggestion_id = s.id AND f.seq = 0
);

-- Deprecate the scalar columns (kept for rollback; no longer written).
ALTER TABLE suggestions ALTER COLUMN code DROP NOT NULL;
ALTER TABLE suggestions ALTER COLUMN file_path DROP NOT NULL;
