-- 0021_graph_status.sql
-- Additive, idempotent. Apply in the Supabase SQL editor BEFORE deploying.
--
-- Adds a rebuild lifecycle to the Graphify graph so the UI has a real
-- completion/failure signal (idle → indexing → succeeded|failed) instead of a
-- silent "0 nodes" build.

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS graph_status text NOT NULL DEFAULT 'idle';
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS graph_error text;

-- Backfill existing rows so a graph that was already built reads as succeeded,
-- and a recorded (0-node) build reads as failed rather than idle.
UPDATE repositories
SET graph_status = CASE
  WHEN graph_built_at IS NOT NULL AND COALESCE(graph_node_count, 0) > 0 THEN 'succeeded'
  WHEN graph_built_at IS NOT NULL THEN 'failed'
  ELSE 'idle'
END
WHERE graph_status = 'idle';
