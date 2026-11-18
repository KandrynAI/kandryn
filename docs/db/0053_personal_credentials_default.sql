-- Kandryn — fix the personal-credentials default  (migration 0053)
--
-- A REGRESSION FROM 0046, confirmed in production on run #42.
--
-- WHAT HAPPENED
--
-- 0046 added teams.allow_personal_credentials as NOT NULL DEFAULT false and
-- backfilled `true` for every workspace that existed at the time, so no
-- existing customer noticed. But `ensureUserHasTeam` never set the column, so
-- every workspace created AFTER that deploy took the default, false.
--
-- resolveGitCreds (services/gitToken.ts) skips a person's own token when this
-- flag is false and returns the workspace's instead. A brand-new workspace
-- owns no credentials of its own, so the result was `undefined`: the GitHub
-- client was built unauthenticated, and GitHub answers 404 for a repository an
-- anonymous caller cannot see. The customer saw "Not Found" and a
-- documentation link about git refs, for a problem entirely about
-- credentials. The response carried x-ratelimit-limit: 60, GitHub's anonymous
-- ceiling, which is what identified it.
--
-- WHY TRUE IS THE RIGHT DEFAULT, not merely the compatible one
--
-- The flag exists so an admin can RESTRICT a workspace to credentials it owns.
-- That is a decision worth taking once there is something to restrict to.
-- Starting restricted while owning nothing is not a safe default; it is a
-- broken one, and it fails silently, which is worse than failing loudly.
--
-- THE BACKFILL IS DELIBERATELY NARROW
--
-- A workspace sitting on false cannot be told apart, from the column alone,
-- from one whose admin turned personal credentials off on purpose. So this
-- only repairs workspaces where the policy CANNOT be working as intended:
-- personal credentials forbidden AND no workspace git credential of its own,
-- which means nothing can authenticate for anyone in it. A workspace that
-- forbids personal credentials and owns a token is a working, deliberate
-- configuration and is left exactly as it is.
--
-- team_integrations holds workspace credentials (getTeamConfig reads it). Only
-- the presence of the row is tested here, never its value: those values are
-- encrypted at rest and SQL has no business decrypting them.
--
-- Idempotent: the ALTER is unconditional but sets the same value every time,
-- and the UPDATE's own predicate stops matching once it has run.

ALTER TABLE teams
  ALTER COLUMN allow_personal_credentials SET DEFAULT true;

UPDATE teams t
   SET allow_personal_credentials = true
 WHERE t.allow_personal_credentials = false
   AND NOT EXISTS (
     SELECT 1
       FROM team_integrations ti
      WHERE ti.team_id = t.id
        AND ti.key IN ('GITHUB_TOKEN', 'AZURE_REPOS_TOKEN')
   );
