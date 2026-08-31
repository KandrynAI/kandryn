-- Kandryn — Aegis security-gate override  (migration 0034)
--
-- A deliberate, audited path past a blocked Aegis gate.
--
-- A separate table rather than columns on `runs` for two reasons: a run can be
-- re-scanned (runs.security_scan is overwritten), and the whole point of the
-- record is to answer "what exactly was overridden, and why" long after the
-- fact. findings_snapshot is therefore a frozen copy taken at override time,
-- not a reference to whatever the run currently says.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS aegis_overrides (
  id                serial PRIMARY KEY,
  run_id            integer NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  suggestion_id     integer,
  project_id        integer,
  team_id           integer,

  -- Who cleared the gate. The real authenticated Clerk user, never a role.
  overridden_by     text NOT NULL,
  -- Who started the run (runs.run_by_user_id at override time). Null for runs
  -- predating 0032, which is why same_actor is nullable rather than false.
  triggered_by      text,
  -- Denormalised so reporting can flag self-overrides without re-deriving it
  -- from two nullable columns. Null = trigger identity unknown (legacy run).
  same_actor        boolean,
  -- Whether the project required a second approver at the time. Records which
  -- rule was in force, so a later toggle doesn't rewrite history.
  second_approver_required boolean NOT NULL DEFAULT false,

  -- Mandatory. Enforced again in the API with a trimmed, non-empty check.
  reason            text NOT NULL CHECK (btrim(reason) <> ''),

  -- The gate's own words at override time: coverage (unscanned files) or
  -- findings (critical/high). These block for different reasons and an auditor
  -- needs to know which.
  gate_reason       text,
  findings_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  critical_count    integer NOT NULL DEFAULT 0,
  high_count        integer NOT NULL DEFAULT 0,
  unscanned_count   integer NOT NULL DEFAULT 0,
  unscanned_files   jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Did the GitHub status check actually get flipped to success? False for a
  -- non-GitHub repo or a missing token — the override is still recorded, but it
  -- had no external effect and the UI must not claim otherwise.
  status_reposted   boolean NOT NULL DEFAULT false,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aegis_overrides_run_idx  ON aegis_overrides (run_id);
CREATE INDEX IF NOT EXISTS aegis_overrides_team_idx ON aegis_overrides (team_id, created_at DESC);
-- Admin-tier reporting reads self-overrides directly.
CREATE INDEX IF NOT EXISTS aegis_overrides_same_actor_idx
  ON aegis_overrides (team_id, created_at DESC) WHERE same_actor;
