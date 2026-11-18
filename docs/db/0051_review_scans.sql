-- Kandryn — the whole-repository code review  (migration 0051)
--
-- Reading an existing codebase and reporting the defects a reviewer would
-- raise, as a batch job collected by the cron dispatcher.
--
-- WHY ITS OWN TABLES, not a `kind` column on baseline_scans
--
-- The two share their execution machinery, because that part is about
-- surviving a 300-second function and nothing else: one Anthropic Message
-- Batch, a sweep for a start that died before submitting, a collector on the
-- tick. Nothing else about them is the same. A different prompt, a different
-- taxonomy (eight review categories, not ten OWASP classes), a different
-- severity scale with no `critical`, and a different reader. Sharing the table
-- would have put a `kind` discriminator on every query, forced it into the
-- fingerprint, and left a triage screen that has to filter before it can say
-- anything true. It would also have changed a shipped, triaged security table
-- for no gain. Separate costs a duplicated collector; shared costs the
-- correctness of what already works.
--
-- WHY THERE IS NO `critical` SEVERITY
--
-- A review finding is not a vulnerability. "High" here means a reviewer would
-- block the pull request. Reusing Aegis's scale would let a duplicated helper
-- and an injection flaw sit under one word, and someone would eventually read
-- the two sets of findings as one queue.
--
-- WHAT IS STORED, and why each one
--
-- file_paths is frozen at submit and never re-derived. A request's custom_id
-- indexes into it, so re-deriving after a push attributes a finding to a
-- different file. That is not hypothetical: it is what 0036 was written to fix
-- on the security scan.
--
-- path_prefix records what was ASKED for, where file_paths records what was
-- read, so two reviews of one repository are comparable.
--
-- input_tokens and output_tokens are the facts the provider reported;
-- actual_cost_usd is those tokens through the rate table in
-- services/baselineScanCore.ts. Both, so an old review can be re-priced when a
-- published rate moves.
--
-- The CHECK on acknowledge_reason is the one from baseline_findings, for the
-- same reason: a dismissal with no stated reason is indistinguishable from a
-- finding nobody looked at, and it is carried forward silently into every
-- later review.
--
-- `drizzle-kit push` creates tables but not triggers, and DROPS indexes and
-- checks it cannot see in the Drizzle schema. Everything below is therefore
-- also declared in lib/db/src/schema/reviewScans.ts. No trigger is installed:
-- in particular these tables do NOT get audit_log's hash chain, which
-- serializes on a team's chain head and is wrong for a few hundred rows per
-- review.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and the
-- constraints inside the table definition.

CREATE TABLE IF NOT EXISTS review_scans (
  id                  serial PRIMARY KEY,
  repository_id       integer      NOT NULL,
  project_id          integer,
  team_id             integer,
  triggered_by        text         NOT NULL,

  status              text         NOT NULL DEFAULT 'queued'
                                   CONSTRAINT review_scans_status_valid
                                   CHECK (status IN ('queued', 'scanning', 'succeeded', 'failed')),

  files_total         integer      NOT NULL DEFAULT 0,
  files_reviewed      integer      NOT NULL DEFAULT 0,
  files_skipped       integer      NOT NULL DEFAULT 0,

  high_count          integer      NOT NULL DEFAULT 0,
  medium_count        integer      NOT NULL DEFAULT 0,
  low_count           integer      NOT NULL DEFAULT 0,

  file_paths          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  path_prefix         text,

  batch_id            text,
  model               text,

  estimated_cost_usd  numeric(10, 4),
  actual_cost_usd     numeric(10, 4),
  input_tokens        integer,
  output_tokens       integer,

  started_at          timestamptz,
  finished_at         timestamptz,
  error               text,
  created_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_scans_repo_idx   ON review_scans (repository_id);
CREATE INDEX IF NOT EXISTS review_scans_status_idx ON review_scans (status);

CREATE TABLE IF NOT EXISTS review_findings (
  id                  serial PRIMARY KEY,
  scan_id             integer      NOT NULL REFERENCES review_scans(id) ON DELETE CASCADE,

  severity            text         NOT NULL
                                   CONSTRAINT review_findings_severity_valid
                                   CHECK (severity IN ('high', 'medium', 'low')),
  category            text         NOT NULL DEFAULT 'other',
  file_path           text         NOT NULL,
  title               text         NOT NULL,
  detail              text         NOT NULL DEFAULT '',
  line_ref            text,
  remediation         text         NOT NULL DEFAULT '',

  fingerprint         text         NOT NULL,

  status              text         NOT NULL DEFAULT 'open',
  acknowledged_by     text,
  acknowledged_at     timestamptz,
  acknowledge_reason  text,

  created_at          timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT review_findings_ack_has_reason
    CHECK (status <> 'acknowledged' OR btrim(coalesce(acknowledge_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS review_findings_scan_idx        ON review_findings (scan_id);
CREATE INDEX IF NOT EXISTS review_findings_fingerprint_idx ON review_findings (fingerprint);
