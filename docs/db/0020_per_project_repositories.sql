-- 0020_per_project_repositories.sql
-- Additive + data repair, idempotent. Apply in the Supabase SQL editor BEFORE
-- deploying.
--
-- Makes repositories.project_id the single source of truth for the project↔repo
-- binding. Splits repository rows shared by multiple projects into one row per
-- project, snapshots the repository onto each run, and deprecates
-- projects.repository_id (kept nullable, no longer written).

-- 1. Verification flag for rows produced by the split (their URL/stack/graph may
--    have come from another project's codebase and must be confirmed).
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS needs_verification boolean NOT NULL DEFAULT false;

-- 2. Snapshot the repository on each run.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS repository_id integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_repository_id_fkey') THEN
    ALTER TABLE runs
      ADD CONSTRAINT runs_repository_id_fkey
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Deprecate projects.repository_id (nullable; no longer written).
ALTER TABLE projects ALTER COLUMN repository_id DROP NOT NULL;

-- 4. Establish one owned repository per project via repositories.project_id.
--    Processed in project-id order. A repo referenced by more than one project is
--    "shared"; the first project either adopts it (flagged for verification,
--    since ownership is ambiguous) and every other project gets a flagged clone.
--    A repo used by a single project is simply adopted, unflagged.
DO $$
DECLARE
  p RECORD;
  r RECORD;
  share_count integer;
  new_id integer;
BEGIN
  FOR p IN SELECT id, user_id, repository_id FROM projects
           WHERE repository_id IS NOT NULL ORDER BY id LOOP
    -- Already owns a repo? Nothing to do.
    IF EXISTS (SELECT 1 FROM repositories WHERE project_id = p.id) THEN
      CONTINUE;
    END IF;

    SELECT * INTO r FROM repositories WHERE id = p.repository_id;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT count(*) INTO share_count FROM projects WHERE repository_id = r.id;

    IF r.project_id IS NULL OR r.project_id = p.id THEN
      -- Adopt. Flag only if the repo was shared (ambiguous which project it fits).
      UPDATE repositories
        SET project_id = p.id,
            needs_verification = needs_verification OR (share_count > 1)
        WHERE id = r.id;
    ELSE
      -- Owned by another project already: clone it for this project, flagged.
      INSERT INTO repositories
        (user_id, name, provider, url, default_branch, project_id,
         needs_reconfiguration, needs_verification, stack_profile,
         graph_json, graph_built_at, graph_node_count, created_at)
      SELECT user_id, name, provider, url, default_branch, p.id,
             needs_reconfiguration, true, stack_profile,
             graph_json, graph_built_at, graph_node_count, now()
      FROM repositories WHERE id = r.id
      RETURNING id INTO new_id;
    END IF;
  END LOOP;
END $$;

-- 5. Backfill runs.repository_id from each run's project's owned repository.
--    Runs whose project has no owned repo cannot be resolved — flag them in the
--    error column (without overwriting an existing error) rather than nulling
--    silently.
UPDATE runs rn
SET repository_id = r.id
FROM repositories r
WHERE r.project_id = rn.project_id
  AND rn.repository_id IS NULL;

UPDATE runs
SET error = COALESCE(error,
      '[0020] repository could not be resolved for this run — project has no bound repository.')
WHERE repository_id IS NULL;
