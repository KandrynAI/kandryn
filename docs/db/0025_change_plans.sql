-- 0025_change_plans.sql
-- Additive, idempotent. Apply in the Supabase SQL editor BEFORE deploying.
--
-- Phase 2 PR1: a change plan belongs to a run (both agents implement the same
-- plan). Plans are revisioned rather than mutated — editing supersedes the prior
-- revision and inserts revision + 1 — so the durable record survives audit
-- retention (used later for planner-quality reporting).

CREATE TABLE IF NOT EXISTS change_plans (
  id              serial PRIMARY KEY,
  run_id          integer NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  revision        integer NOT NULL DEFAULT 1,
  superseded      boolean NOT NULL DEFAULT false,
  status          text NOT NULL,          -- planning | ready | edited | failed
  model           text,
  candidate_files jsonb,                  -- what retrieval returned, for tuning
  notes           text,                   -- planner notes for the generators
  retrieval_mode  text,                   -- graph | keyword
  graph_built_at  timestamptz,            -- null when no graph was used
  graph_age_hours double precision,       -- graph age at plan time (age-only staleness)
  planning_ms     integer,
  retrieval_ms    integer,
  input_tokens    integer,
  output_tokens   integer,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, revision)
);

CREATE INDEX IF NOT EXISTS change_plans_run_id_idx ON change_plans (run_id);

CREATE TABLE IF NOT EXISTS change_plan_files (
  id            serial PRIMARY KEY,
  plan_id       integer NOT NULL REFERENCES change_plans(id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  op            text NOT NULL,            -- create | edit | delete
  file_path     text NOT NULL,
  rationale     text NOT NULL,            -- one line, shown in the UI
  symbols       jsonb,                    -- optional methods/types to add or change
  added_by_user boolean NOT NULL DEFAULT false,
  added_source  text,                     -- autocomplete | manual (when added_by_user)
  in_candidates boolean,                  -- was this path in candidate_files?
  UNIQUE (plan_id, seq)
);

CREATE INDEX IF NOT EXISTS change_plan_files_plan_id_idx ON change_plan_files (plan_id);
