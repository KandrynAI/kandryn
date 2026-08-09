-- 0017_multitenancy.sql
-- Multi-tenancy: teams, members, invites, shared credentials.
-- Additive only — all IF NOT EXISTS. Apply in Supabase before deploying.
--
-- NOTE: numbered 0017 because 0016 is already taken (0016_aegis_remediation.sql).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── TEAMS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id              serial PRIMARY KEY,
  name            text NOT NULL,
  slug            text UNIQUE,
  owner_user_id   text NOT NULL,
  plan            text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free','pro','max','enterprise')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teams_owner_idx ON teams (owner_user_id);

-- ── TEAM MEMBERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id          serial PRIMARY KEY,
  team_id     integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     text NOT NULL,
  role        text NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin','member')),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_team_idx ON team_members (team_id);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members (user_id);

-- ── TEAM INVITES ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_invites (
  id            serial PRIMARY KEY,
  team_id       integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invited_by    text NOT NULL,
  email         text NOT NULL,
  role          text NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin','member')),
  token         text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at   timestamptz,
  UNIQUE (team_id, email)
);
CREATE INDEX IF NOT EXISTS team_invites_token_idx ON team_invites (token);
CREATE INDEX IF NOT EXISTS team_invites_team_idx  ON team_invites (team_id);

-- ── TEAM INTEGRATIONS (shared credentials) ─────────────────────────
CREATE TABLE IF NOT EXISTS team_integrations (
  id        serial PRIMARY KEY,
  team_id   integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  key       text NOT NULL,
  value     text NOT NULL,
  set_by    text NOT NULL,
  set_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, key)
);
CREATE INDEX IF NOT EXISTS team_integrations_team_idx ON team_integrations (team_id);

-- ── MODIFY PROJECTS ────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS team_id    integer REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'personal'
    CHECK (visibility IN ('personal','team'));
CREATE INDEX IF NOT EXISTS projects_team_idx ON projects (team_id) WHERE team_id IS NOT NULL;

-- ── MODIFY RUNS ────────────────────────────────────────────────────
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS run_by_user_id text;
COMMENT ON COLUMN runs.run_by_user_id IS
  'The team member who triggered this run. May differ from user_id (project owner) in team context.';
CREATE INDEX IF NOT EXISTS runs_run_by_idx ON runs (run_by_user_id) WHERE run_by_user_id IS NOT NULL;
