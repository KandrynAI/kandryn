-- 0019_repositories_project_scope.sql
-- Additive, idempotent. Apply in the Supabase SQL editor BEFORE deploying.
--
-- Adds project scoping and a reconfiguration flag to repositories, makes url
-- nullable, and repairs existing rows whose URL points at owner === repo (e.g.
-- https://github.com/acme/acme), which is never a real code repository. Such
-- rows have their URL cleared and are flagged for reconfiguration rather than
-- deleted, so no data is lost.

-- 1. Owning project (nullable). FK added separately below so re-runs are safe.
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS project_id integer;

-- 2. Reconfiguration flag.
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS needs_reconfiguration boolean NOT NULL DEFAULT false;

-- 3. Allow url to be null (a flagged row has no valid URL until reconfigured).
ALTER TABLE repositories ALTER COLUMN url DROP NOT NULL;

-- 4. FK repositories.project_id -> projects.id (guarded; ON DELETE SET NULL so
--    deleting a project just unlinks its repositories).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'repositories_project_id_fkey'
  ) THEN
    ALTER TABLE repositories
      ADD CONSTRAINT repositories_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 5. Repair existing owner === repo rows: null the URL and flag for reconfig.
--    Matches https://github.com/{owner}/{owner} (optional www, .git, trailing /),
--    case-insensitively via a backreference.
UPDATE repositories
SET url = NULL, needs_reconfiguration = true
WHERE url ~* '^https?://(www\.)?github\.com/([^/]+)/\2(\.git)?/?$';
