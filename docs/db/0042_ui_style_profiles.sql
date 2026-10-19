-- Kandryn — how a project's interface is already styled  (migration 0042)
--
-- Project Context part 2: Kandryn reads the repository's styling — tokens,
-- components, conventions — and reuses it when generating UI code, instead of
-- inventing a second design system inside someone else's app.
--
-- Everything stored here is EXTRACTED DETERMINISTICALLY by static parsing.
-- Nothing from the customer's repository is executed, imported or evaluated,
-- and no file CONTENT is stored: only values (a colour, a component name, a
-- path, a line number) that were validated before being written.
--
-- One row per project, so the profile survives a repository rebind;
-- `repository_id` records which repo it was last read from. Re-extraction
-- overwrites the content columns and bumps `revision`.
--
-- No trigger is installed, so the "drizzle-kit push does not create triggers"
-- trap (0033, 0038) does not apply here. The two INDEXES do matter: push
-- drops any index it cannot see in the Drizzle schema (0041), so both are
-- declared there as well.
--
-- Additive + idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS ui_style_profiles (
  id              serial       PRIMARY KEY,
  user_id         text         NOT NULL,
  project_id      integer      NOT NULL,
  repository_id   integer,
  status          text         NOT NULL DEFAULT 'pending',
                  -- pending | extracting | ready | not_applicable | failed
  stale           boolean      NOT NULL DEFAULT false,
  enabled         boolean      NOT NULL DEFAULT true,
  revision        integer      NOT NULL DEFAULT 0,
  ui_root         text,
  ui_root_options jsonb,
  source_ref      text,
  framework       jsonb,
  tokens          jsonb,
  components      jsonb,
  conventions     jsonb,
  exemplars       jsonb,
  warnings        jsonb,
  error           text,
  extract_ms      integer,
  extracted_at    timestamptz,
  claimed_at      timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

-- One profile per project. A second insert raises 23505, which the route
-- turns into a 409 rather than a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS ui_style_profiles_project_uq
  ON ui_style_profiles (project_id);

-- The dispatcher's claim query: due work only, so the index stays small.
CREATE INDEX IF NOT EXISTS ui_style_profiles_pending_idx
  ON ui_style_profiles (status, claimed_at)
  WHERE status = 'pending';
