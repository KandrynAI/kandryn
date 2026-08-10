-- 0018_audit_log.sql
-- Audit log for all significant user actions.
-- Retention enforced by nightly cron per plan tier.
-- Idempotent.

CREATE TABLE IF NOT EXISTS audit_log (
  id           serial       PRIMARY KEY,
  team_id      integer      REFERENCES teams(id) ON DELETE CASCADE,
  user_id      text         NOT NULL,
  action       text         NOT NULL,
  entity_type  text,
  entity_id    integer,
  metadata     jsonb,
  ip_address   text,
  user_agent   text,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

-- Primary access pattern: team admin views their team's log
CREATE INDEX IF NOT EXISTS audit_log_team_created_idx
  ON audit_log (team_id, created_at DESC)
  WHERE team_id IS NOT NULL;

-- Secondary: per-user queries for member visibility
CREATE INDEX IF NOT EXISTS audit_log_user_created_idx
  ON audit_log (user_id, created_at DESC);

-- Filter by action type
CREATE INDEX IF NOT EXISTS audit_log_action_idx
  ON audit_log (action);

COMMENT ON TABLE audit_log IS
  'Immutable record of all significant platform actions.
   Rows are never updated — only inserted and eventually deleted
   by the retention cron based on plan tier.';

COMMENT ON COLUMN audit_log.action IS
  'Dot-separated action name, e.g. run.committed, member.invited,
   credential.set. Always present.';

COMMENT ON COLUMN audit_log.metadata IS
  'Action-specific detail. Never contains credential values.
   May contain: agentName, score, prUrl, itemTitle, targetEmail,
   oldRole, newRole, configKey (never configValue), etc.';
