-- 0011_run_graph_context.sql — Graphify Phase 3
-- Records whether a run's code context was sourced from the Graphify knowledge
-- graph (precise, low-token) rather than the keyword fallback. Surfaced as a
-- "Graph context" badge on the run detail page.
--
-- Idempotent — safe to re-run. Apply in the Supabase SQL editor before deploying
-- the Phase 3 code (the write path sets this column on every run).

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS used_graph_context boolean NOT NULL DEFAULT false;
