-- 0010_graphify_graph.sql
-- Stores the Graphify knowledge graph for each repository.
-- graph_json: the full graph.json output from graphify build
-- graph_built_at: when the graph was last built
-- graph_node_count: for quick health checks
-- Idempotent.

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS graph_json       jsonb;

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS graph_built_at   timestamptz;

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS graph_node_count integer;

CREATE INDEX IF NOT EXISTS repositories_graph_built_at_idx
  ON repositories (graph_built_at)
  WHERE graph_built_at IS NOT NULL;
