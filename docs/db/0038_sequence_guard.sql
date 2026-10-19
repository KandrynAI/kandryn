-- Kandryn — Sequence Guard  (migration 0038)
--
-- Run-order checking: dependency edges between work items, a snapshot of every
-- order check a user was shown, and an immutable record of each decision to run
-- an item out of order anyway.
--
-- Why the decision needs its own table rather than a column on `runs`: a run is
-- mutable (re-scanned, re-committed, deleted), and the whole value of this row
-- is answering "what exactly was this person shown, and what did they choose"
-- months later. Everything the user saw is therefore frozen here — findings,
-- impact text, the policy in force — rather than referenced.
--
-- Three deliberate departures from the feature spec, each forced by the schema
-- as it actually stands (see the PR0 report):
--
--   1. Work items live in `tasks`, not `work_items`. The table was deliberately
--      never renamed; all references below point at `tasks`.
--   2. `team_id` is NULLABLE here, and `user_id` is the scoping column. The spec
--      asked for `team_id NOT NULL`, but `projects.team_id` is nullable and a
--      personal project has none — a NOT NULL team_id would make this feature
--      unusable for every solo operator. This mirrors `aegis_overrides` (0034),
--      where team_id is a nullable denormalised column for reporting and access
--      is decided by user_id plus `canAdminister`.
--   3. Team policy is a column on `teams`, not a settings JSON blob. There is no
--      settings store on teams; `audit_retention_days` (0031) set the precedent
--      that a per-team setting is a plain nullable column.
--
-- Additive + idempotent. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Dependency edges between work items.
-- ---------------------------------------------------------------------------
-- link_type 'blocks':  from_item must finish before to_item can safely run.
-- link_type 'parent':  from_item is the parent of to_item.
-- link_type 'relates': informational only; never produces a finding.
--
-- `source` matters for sync: tracker links are reconciled against the tracker on
-- every sync (stale ones deleted), while 'manual' and 'inferred' rows are never
-- touched by sync. The UNIQUE constraint includes source so the same edge can
-- legitimately exist from two origins (a human confirming what the model
-- guessed) without one clobbering the other.
CREATE TABLE IF NOT EXISTS work_item_links (
  id            serial       PRIMARY KEY,
  user_id       text         NOT NULL,
  team_id       integer      REFERENCES teams(id) ON DELETE CASCADE,
  project_id    integer      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_item_id  integer      NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_item_id    integer      NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  link_type     text         NOT NULL CHECK (link_type IN ('blocks','parent','relates')),
  source        text         NOT NULL CHECK (source IN ('tracker','inferred','manual')),
  -- Only meaningful for source 'inferred'; null for tracker and manual links.
  confidence    numeric(3,2),
  -- A dismissed link is kept, not deleted: "a human said this is not a
  -- dependency" is itself worth retaining, and re-syncing must not resurrect it.
  dismissed_at  timestamptz,
  dismissed_by  text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  -- An item cannot block itself; a self-edge would make every cycle check
  -- trivially true.
  CONSTRAINT work_item_links_no_self CHECK (from_item_id <> to_item_id),
  CONSTRAINT work_item_links_edge_uq UNIQUE (from_item_id, to_item_id, link_type, source)
);

-- The analysis reads edges by project (both directions at once), so the hot
-- index is project-leading, not team-leading: team_id is null for every personal
-- project and would be dead weight at the front of the key.
CREATE INDEX IF NOT EXISTS work_item_links_to_idx
  ON work_item_links (project_id, to_item_id) WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS work_item_links_from_idx
  ON work_item_links (project_id, from_item_id) WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS work_item_links_user_idx
  ON work_item_links (user_id);

-- ---------------------------------------------------------------------------
-- Snapshot of every order check shown to a user.
-- ---------------------------------------------------------------------------
-- Stored rather than recomputed because what the user SAW is what gets audited.
-- `fingerprint` lets the run request detect that the world moved between the
-- check and the confirmation without diffing the whole payload.
CREATE TABLE IF NOT EXISTS sequence_checks (
  id               serial       PRIMARY KEY,
  user_id          text         NOT NULL,
  team_id          integer      REFERENCES teams(id) ON DELETE CASCADE,
  work_item_id     integer      NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  verdict          text         NOT NULL CHECK (verdict IN ('clear','caution','warning')),
  findings         jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- The deterministic fact bundle (F1, F2, …) the impact narrative is grounded
  -- in. Never contains file CONTENTS or credential values — paths only.
  facts            jsonb        NOT NULL DEFAULT '[]'::jsonb,
  policy_snapshot  jsonb        NOT NULL,
  fingerprint      text         NOT NULL,
  -- Cached ImpactAnalysis; null until the user opens step 2 of the dialog.
  impact           jsonb,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  expires_at       timestamptz  NOT NULL
);

CREATE INDEX IF NOT EXISTS sequence_checks_item_idx
  ON sequence_checks (work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sequence_checks_user_idx
  ON sequence_checks (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- The user decision. Immutable. One row per confirmed override.
-- ---------------------------------------------------------------------------
-- PR0 found no generic decisions table — `aegis_overrides` (0034) is specific to
-- the security gate — so this is its own table, mirroring that one's naming and
-- its role checks (`canAdminister`).
--
-- work_item_key/title are denormalised on purpose: the record must still read
-- correctly after the item is deleted and work_item_id has gone null.
CREATE TABLE IF NOT EXISTS sequence_overrides (
  id                      serial       PRIMARY KEY,
  user_id                 text         NOT NULL,
  team_id                 integer      REFERENCES teams(id) ON DELETE CASCADE,
  -- The role the actor held AT DECISION TIME. A later demotion must not rewrite
  -- what authority the decision was made under.
  user_role               text         NOT NULL,
  work_item_id            integer      REFERENCES tasks(id) ON DELETE SET NULL,
  work_item_key           text         NOT NULL,
  work_item_title         text         NOT NULL,
  project_id              integer      REFERENCES projects(id) ON DELETE SET NULL,
  run_id                  integer      REFERENCES runs(id) ON DELETE SET NULL,
  check_id                integer      REFERENCES sequence_checks(id) ON DELETE SET NULL,
  verdict_at_decision     text         NOT NULL,
  findings_acknowledged   jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- The exact impact text the user read, verbatim. Not a reference to the check:
  -- the check expires and may be pruned.
  impact_shown            jsonb        NOT NULL,
  impact_source           text         NOT NULL CHECK (impact_source IN ('ai','deterministic')),
  impact_model            text,
  reason_category         text         NOT NULL,
  -- Required by the API when any finding is a warning; optional for caution-only.
  reason_text             text,
  acknowledged_impact     boolean      NOT NULL,
  policy_snapshot         jsonb        NOT NULL,
  scheduled_at            timestamptz,
  ip_address              text,
  user_agent              text,
  record_hash             text         NOT NULL,
  created_at              timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sequence_overrides_team_idx
  ON sequence_overrides (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sequence_overrides_user_idx
  ON sequence_overrides (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sequence_overrides_item_idx
  ON sequence_overrides (work_item_id);
CREATE INDEX IF NOT EXISTS sequence_overrides_run_idx
  ON sequence_overrides (run_id);

-- Immutability.
--
-- UPDATE is blocked outright, with one sanctioned exception: the four
-- ON DELETE SET NULL foreign keys above perform an UPDATE when their target is
-- deleted. Allow exactly those four single-column nullings and nothing else.
--
-- One branch per column is correct because Postgres fires each referential
-- action as its own statement: deleting a project, which cascades to runs,
-- tasks and checks, arrives here as four separate single-column updates, not
-- one combined update. Verified against all four cascade paths on a throwaway
-- Postgres 16 before this migration was committed.
CREATE OR REPLACE FUNCTION sequence_overrides_block_update() RETURNS trigger AS $$
BEGIN
  IF NEW.run_id IS NULL AND OLD.run_id IS NOT NULL
     AND (to_jsonb(NEW) - 'run_id') = (to_jsonb(OLD) - 'run_id') THEN
    RETURN NEW;
  END IF;
  IF NEW.work_item_id IS NULL AND OLD.work_item_id IS NOT NULL
     AND (to_jsonb(NEW) - 'work_item_id') = (to_jsonb(OLD) - 'work_item_id') THEN
    RETURN NEW;
  END IF;
  IF NEW.project_id IS NULL AND OLD.project_id IS NOT NULL
     AND (to_jsonb(NEW) - 'project_id') = (to_jsonb(OLD) - 'project_id') THEN
    RETURN NEW;
  END IF;
  IF NEW.check_id IS NULL AND OLD.check_id IS NOT NULL
     AND (to_jsonb(NEW) - 'check_id') = (to_jsonb(OLD) - 'check_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'sequence_overrides rows are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sequence_overrides_immutable ON sequence_overrides;
CREATE TRIGGER sequence_overrides_immutable
  BEFORE UPDATE ON sequence_overrides
  FOR EACH ROW EXECUTE FUNCTION sequence_overrides_block_update();

COMMENT ON TABLE sequence_overrides IS
  'Immutable record that a named user chose to run a work item out of order, '
  'what they were shown, and why. record_hash is sha256 of the canonical JSON '
  'of all columns except id, run_id, work_item_id, project_id, check_id and '
  'created_at (those can be nulled by foreign keys). Retention follows the '
  'audit log retention for the team plan.';

-- ---------------------------------------------------------------------------
-- Team policy.
-- ---------------------------------------------------------------------------
-- 'off'                 do not check run order at all
-- 'warn'                warn; any member may override with a reason  (default)
-- 'admin_override_only' warn; only a team admin may override
--
-- Nullable with an application-side default of 'warn', matching
-- audit_retention_days (0031): a user with no team row still gets the default.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS sequence_policy text;
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_sequence_policy_check;
ALTER TABLE teams ADD CONSTRAINT teams_sequence_policy_check
  CHECK (sequence_policy IS NULL OR sequence_policy IN ('off','warn','admin_override_only'));

-- ---------------------------------------------------------------------------
-- Backlog rank.
-- ---------------------------------------------------------------------------
-- Sprint/backlog rank from the tracker, when it returns one. Feeds only the
-- advisory 'out_of_rank' caution; null everywhere the tracker gives nothing, and
-- the check skips that finding entirely when rank data is absent.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS plm_rank integer;
