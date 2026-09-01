-- Kandryn — baseline security scan  (migration 0035)
--
-- A one-off Aegis scan of an EXISTING codebase, run when a repository is
-- connected. Deliberately not modelled on `runs`:
--
--   * There is no commit and no gate. Aegis's runtime scan decides
--     approved/blocked for a change set about to merge; a baseline scan
--     describes code that is already there. Nothing is blocked, so no gate
--     state is stored — `files_scanned` / `files_total` carry coverage instead.
--   * Findings are rows, not a jsonb blob on a parent. Each one is triaged
--     individually — acknowledged, or pushed to the tracker — and matched
--     against the next scan.
--
-- Kept off `runs` entirely so the security reports, which read
-- runs.security_scan, cannot mistake a baseline finding for a blocked run.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS baseline_scans (
  id              serial PRIMARY KEY,
  repository_id   integer NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  project_id      integer,
  team_id         integer,
  triggered_by    text NOT NULL,

  status          text NOT NULL DEFAULT 'queued',   -- queued|scanning|succeeded|failed|canceled

  -- Coverage, never a gate. files_skipped counts files excluded before the
  -- scan (binary, vendored, over the size cap); files_total - files_scanned -
  -- files_skipped is what the model failed to return.
  files_total     integer NOT NULL DEFAULT 0,
  files_scanned   integer NOT NULL DEFAULT 0,
  files_skipped   integer NOT NULL DEFAULT 0,

  critical_count  integer NOT NULL DEFAULT 0,
  high_count      integer NOT NULL DEFAULT 0,
  medium_count    integer NOT NULL DEFAULT 0,
  low_count       integer NOT NULL DEFAULT 0,

  -- The Anthropic Message Batch backing this scan. The cron dispatcher polls
  -- it; a scan cannot run inside a request (maxDuration 300).
  batch_id        text,
  -- What the admin was shown and approved before any spend began.
  estimated_cost_usd numeric(10, 4),

  started_at      timestamptz,
  finished_at     timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS baseline_findings (
  id              serial PRIMARY KEY,
  scan_id         integer NOT NULL REFERENCES baseline_scans(id) ON DELETE CASCADE,

  severity        text NOT NULL,
  owasp           text NOT NULL DEFAULT 'Other',
  file_path       text NOT NULL,
  title           text NOT NULL,
  detail          text NOT NULL DEFAULT '',
  line_ref        text,
  remediation     text NOT NULL DEFAULT '',

  -- hash(file_path, normalised title, owasp). Deliberately excludes the line
  -- number: an edit elsewhere in the file shifts every line below it, and a
  -- finding the team already triaged must not come back as new.
  fingerprint     text NOT NULL,

  plm_ticket_key  text,
  plm_ticket_url  text,

  status          text NOT NULL DEFAULT 'open',     -- open|acknowledged|pushed
  acknowledged_by text,
  acknowledged_at timestamptz,
  -- Mandatory when acknowledging, same discipline as an Aegis gate override:
  -- a dismissal with no stated reason is not a decision anyone can audit.
  acknowledge_reason text,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT baseline_findings_ack_has_reason
    CHECK (status <> 'acknowledged' OR btrim(coalesce(acknowledge_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS baseline_scans_repo_idx ON baseline_scans (repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS baseline_scans_team_idx ON baseline_scans (team_id, created_at DESC);
-- The dispatcher sweeps for scans with a batch still in flight.
CREATE INDEX IF NOT EXISTS baseline_scans_active_idx ON baseline_scans (status) WHERE status = 'scanning';
CREATE INDEX IF NOT EXISTS baseline_findings_scan_idx ON baseline_findings (scan_id);
-- Acknowledgement carry-forward looks findings up by fingerprint across scans.
CREATE INDEX IF NOT EXISTS baseline_findings_fingerprint_idx ON baseline_findings (fingerprint);
