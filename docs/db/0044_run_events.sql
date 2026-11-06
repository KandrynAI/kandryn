-- Kandryn — the live run timeline  (migration 0044)
--
-- One row per structured step an agent took during a run, in order. Drives
-- the live activity feed while a run executes, and stays as the replayable
-- record of a finished one.
--
-- CONTENT-FREE BY CONSTRUCTION. `summary` is built server-side from a template
-- over allowlisted scalars; `data` is filtered to an allowlist per event type.
-- No work item text, document text, diff, prompt or model output can reach
-- this table. Same rule `runs.context_manifest` (0040) follows, for the same
-- reason: a timeline must be readable by anyone who can read the run without
-- widening what they can see.
--
-- SCOPING mirrors `runs`: user_id (the project owner) + project_id. There is
-- deliberately NO team_id — `runs` has none, team visibility is derived from
-- projects.team_id, and a second copy of that fact here could disagree with
-- it. Both columns are denormalised rather than joined through the run on
-- every read (the precedent knowledge_chunks set in 0041).
--
-- NO TRIGGER is installed. In particular this table does NOT get audit_log's
-- hash chain (0033): that trigger serializes inserts on a team's chain head,
-- which is fine for a few audit rows per action and not for ~80 events per
-- run. So the "drizzle-kit push does not create triggers" trap does not apply
-- here. The INDEXES do: push drops any index it cannot see in the Drizzle
-- schema (0041), so both are declared in lib/db/src/schema/runEvents.ts as
-- well, and so are the three CHECK constraints.
--
-- WHY runs.event_seq EXISTS
--
-- `seq` is the cursor the client polls with (`?since_seq=N`), so it has to be
-- monotonic per run AND equal to commit order. A global sequence does not
-- give you the second property, and neither does the serial `id`: both are
-- allocated outside the transaction. Two emitters take 1 and 2; the holder of
-- 2 commits first; a poll lands between the two commits, sees only 2 and
-- advances its cursor past 1 — which is then never delivered. That was
-- measured, not assumed (docs/investigations/live-run-timeline.md §8.1).
--
-- An emitter therefore claims a block with
--   UPDATE runs SET event_seq = event_seq + n WHERE id = $1 RETURNING event_seq
-- INSIDE the insert's own transaction. The row lock is held to commit, so a
-- second emitter cannot claim until the first has committed, and seq order
-- equals commit order. Concurrent emitters on one run are rare — a user firing
-- Veria and Aegis at the same time — so the serialization costs nothing.
--
-- Retention: the events live exactly as long as their run. run_id is
-- ON DELETE CASCADE, so deleting a run takes its timeline with it and no purge
-- job is needed. The knob is RUN_EVENT_RETENTION_DAYS in
-- shared/types/runEvent.ts, null today.
--
-- Additive + idempotent. Safe to re-run.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS event_seq bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS run_events (
  id          serial       PRIMARY KEY,
  run_id      integer      NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  user_id     text         NOT NULL,
  project_id  integer      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq         bigint       NOT NULL,
  agent       text         NOT NULL,
              -- raptia | fovea | synthesia | veria | aegis | narratia | system
  type        text         NOT NULL,
  status      text         NOT NULL,
              -- started | ok | warn | failed | info
  summary     text         NOT NULL,
  data        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  duration_ms integer
);

-- The cursor index, and the guard that makes a double-claim loud (23505)
-- instead of silently reordering the timeline.
CREATE UNIQUE INDEX IF NOT EXISTS run_events_run_seq_uq
  ON run_events (run_id, seq);

CREATE INDEX IF NOT EXISTS run_events_user_created_idx
  ON run_events (user_id, created_at);

-- The three value sets, pinned in the database as well as in TypeScript.
-- Wrapped so a re-run does not fail on an existing constraint (Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'run_events_agent_check') THEN
    ALTER TABLE run_events ADD CONSTRAINT run_events_agent_check
      CHECK (agent IN ('raptia','fovea','synthesia','veria','aegis','narratia','system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'run_events_status_check') THEN
    ALTER TABLE run_events ADD CONSTRAINT run_events_status_check
      CHECK (status IN ('started','ok','warn','failed','info'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'run_events_type_check') THEN
    ALTER TABLE run_events ADD CONSTRAINT run_events_type_check
      CHECK (type IN (
        'run.started','run.completed','run.failed',
        'stage.started','stage.completed','stage.failed',
        'context.read','plan.step','file.write','check.result',
        'score.dimension','runbook.section','gate.result'
      ));
  END IF;
END $$;
