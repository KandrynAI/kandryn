-- Kandryn — record which generation agents dropped out of a run  (migration 0039)
--
-- A run asks Claude and OpenAI in parallel and ranks what comes back. When one
-- of them throws, `Promise.allSettled` keeps the other and the failure was
-- logged and otherwise discarded: no row, no mark on the run, nothing in the
-- UI. A run could therefore silently fall from two candidates to one, which is
-- exactly how run #36 turned a single bad edit anchor into a failed run — the
-- redundancy that should have covered it was gone and nobody was told.
--
-- Nullable jsonb: [{ "agent": "claude", "message": "..." }]. Null on every run
-- predating this column, and on any run where both agents answered.
--
-- Additive + idempotent. Safe to re-run.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS agent_failures jsonb;
