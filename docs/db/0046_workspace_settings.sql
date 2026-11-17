-- 0046 — workspace-owned credentials and policy.
--
-- Additive and idempotent. The ownership rule it encodes: admins own what the
-- organization decides (which credentials, whose spend, whether members may
-- override), users own only what is about themselves.

-- 1. Whose credentials this workspace's agents run on.
--    Nullable, "null = the application default (workspace_keys)", matching
--    audit_retention_days and sequence_policy. A workspace must opt IN to
--    spending Kandryn's money; it is never the default.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS agent_key_source text;

-- 2. Whether a member may override the workspace with their own credentials.
--
--    The backfill lives INSIDE the create branch rather than after it, which is
--    what makes this idempotent without a marker: it runs exactly once, when
--    the column is first added, and a re-run finds the column present and does
--    nothing. Written any other way, a second run would re-open a workspace
--    whose admin had since closed it.
--
--    Why the two cases differ: workspaces that existed before this shipped have
--    members already running on their own credentials, and closing that off
--    under them would break every run. New workspaces start closed and open up
--    by choice.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'teams' AND column_name = 'allow_personal_credentials'
  ) THEN
    ALTER TABLE teams ADD COLUMN allow_personal_credentials boolean NOT NULL DEFAULT false;
    UPDATE teams SET allow_personal_credentials = true;
  END IF;
END $$;

-- 3. Which git token a run used. Its sibling agent_key_source arrived in 0045;
--    that column's "own" becomes "personal" now that "workspace" is a third
--    possibility and "own" would be ambiguous between the two.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS github_source text;
UPDATE runs SET agent_key_source = 'personal' WHERE agent_key_source = 'own';
