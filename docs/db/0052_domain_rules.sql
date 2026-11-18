-- Kandryn — domain context, with evidence and a review gate  (migration 0052)
--
-- What a project MEANS, as opposed to how it is built. `stack_profile` is
-- technical, the Graphify graph is structural, the UI style profile is visual,
-- and none of them carries business meaning. Run #32 is the evidence this
-- exists for: the agent had the code and the acceptance criteria and still
-- read "validate the policy exists" as "check that claims come back".
--
-- THE RISK THAT SHAPES THE WHOLE SCHEMA
--
-- An extracted rule is a model's inference. Stored as fact and injected into
-- every prompt, one wrong rule poisons every later run, and it does so
-- confidently and invisibly, which is worse than having no context at all.
-- Two constraints below are therefore the review gate itself rather than
-- bookkeeping: a service can be edited, a CHECK cannot be forgotten.
--
--   domain_rules_confirmed_has_reviewer — only `confirmed` is authoritative,
--     and a confirmed row must name the person who made it so. An extractor
--     cannot write one, because it has no reviewer to name.
--   domain_rules_rejected_has_reason — a rejection with no stated reason is
--     indistinguishable from a statement nobody looked at, and it is carried
--     forward silently into every later extraction. The same discipline
--     baseline_findings (0035) and review_findings (0051) carry.
--
-- SCOPE: project, with repository-scoped evidence. A rule is a statement about
-- the project's domain; its evidence cites a file in whichever repository was
-- bound when it was read. Repositories get re-pointed to new URLs, and a
-- repository-scoped rule would be destroyed by that, while a project-scoped
-- rule merely loses its evidence and becomes `needs_review`. Rules read from
-- the tracker have no repository to belong to at all.
--
-- WHY EVIDENCE IS A TABLE and not a jsonb column
--
-- The question Phase 4 has to answer is "which rules cite this file", so that
-- a commit can mark them needs_review. That is an indexed join here and a GIN
-- containment query on a blob there, and `drizzle-kit push` silently DROPS a
-- GIN index it cannot see in the Drizzle schema (the trap 0041 paid for). It
-- also makes "every rule carries evidence" checkable as a row count rather
-- than as the shape of a blob.
--
-- THERE IS NO `quote` COLUMN, deliberately. Evidence is identifiers only: a
-- path and a line, a tracker key, a document id, a person. A quote would make
-- this the first table storing excerpts of a customer's code and documents,
-- and the first endpoint returning them to anyone who can read a project. The
-- rule 0042's exemplars follow (`{path, sha}`) and 0044's events follow.
--
-- extraction_id is ON DELETE SET NULL, not CASCADE: a confirmed rule is a
-- human decision and must outlive the job that suggested it, exactly as
-- sequence_overrides (0038) outlives its run. superseded_by is SET NULL for
-- the same reason — a human edit writes a NEW row and supersedes the old one
-- rather than mutating it, so the history of what was confirmed survives.
--
-- `drizzle-kit push` creates tables but not triggers, and DROPS indexes and
-- checks it cannot see in the Drizzle schema. Everything below is therefore
-- also declared in lib/db/src/schema/domainRules.ts. No trigger is installed:
-- these tables do NOT get audit_log's hash chain (0033), which serializes on a
-- team's chain head and is wrong for a few hundred rows per extraction.
--
-- NOTHING READS OR WRITES THESE TABLES YET. This migration is the schema for
-- PR 2a; the extractor, the review gate and the injection path are PRs 2b to
-- 2d. A table nothing writes is safe to apply early and cannot break a path.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and the
-- constraints inside the table definitions.

CREATE TABLE IF NOT EXISTS domain_extractions (
  id                  serial PRIMARY KEY,
  user_id             text         NOT NULL,
  project_id          integer      NOT NULL,
  repository_id       integer,
  team_id             integer,
  triggered_by        text         NOT NULL,

  status              text         NOT NULL DEFAULT 'queued'
                                   CONSTRAINT domain_extractions_status_valid
                                   CHECK (status IN ('queued', 'extracting', 'succeeded', 'failed')),

  -- The commit the code evidence was read at. Without it a rule citing
  -- src/billing.ts:40 cannot be checked against anything later.
  source_ref          text,

  -- Counts of each source kind read. Counts and nothing else, the rule
  -- runs.context_manifest follows: never the text that was read.
  sources_counted     jsonb,
  rules_proposed      integer      NOT NULL DEFAULT 0,

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

CREATE INDEX IF NOT EXISTS domain_extractions_project_idx ON domain_extractions (project_id);
CREATE INDEX IF NOT EXISTS domain_extractions_status_idx  ON domain_extractions (status);

CREATE TABLE IF NOT EXISTS domain_rules (
  id                  serial PRIMARY KEY,
  user_id             text         NOT NULL,
  project_id          integer      NOT NULL,

  extraction_id       integer      REFERENCES domain_extractions(id) ON DELETE SET NULL,

  kind                text         NOT NULL
                                   CONSTRAINT domain_rules_kind_valid
                                   CHECK (kind IN ('rule', 'term', 'entity', 'workflow')),
  statement           text         NOT NULL,
  detail              text,

  status              text         NOT NULL DEFAULT 'proposed'
                                   CONSTRAINT domain_rules_status_valid
                                   CHECK (status IN ('proposed', 'confirmed', 'rejected', 'needs_review')),
  confidence          numeric,
  origin              text         NOT NULL DEFAULT 'inferred'
                                   CONSTRAINT domain_rules_origin_valid
                                   CHECK (origin IN ('inferred', 'human')),

  reviewed_by         text,
  reviewed_at         timestamptz,
  review_note         text,

  superseded_by       integer      REFERENCES domain_rules(id) ON DELETE SET NULL,
  revision            integer      NOT NULL DEFAULT 1,

  -- hash(project, kind, normalised statement). Carries a human decision
  -- forward across re-extractions, so a rejected rule does not come back as
  -- new because the model reworded it.
  fingerprint         text         NOT NULL,

  created_at          timestamptz  NOT NULL DEFAULT now(),

  -- The review gate, made structural. See the header.
  CONSTRAINT domain_rules_confirmed_has_reviewer
    CHECK (status <> 'confirmed' OR reviewed_by IS NOT NULL),
  CONSTRAINT domain_rules_rejected_has_reason
    CHECK (status <> 'rejected' OR btrim(coalesce(review_note, '')) <> '')
);

CREATE INDEX IF NOT EXISTS domain_rules_project_idx     ON domain_rules (project_id);
CREATE INDEX IF NOT EXISTS domain_rules_status_idx      ON domain_rules (status);
CREATE INDEX IF NOT EXISTS domain_rules_fingerprint_idx ON domain_rules (fingerprint);

CREATE TABLE IF NOT EXISTS domain_rule_evidence (
  id                   serial PRIMARY KEY,
  rule_id              integer     NOT NULL REFERENCES domain_rules(id) ON DELETE CASCADE,

  kind                 text        NOT NULL
                                   CONSTRAINT domain_rule_evidence_kind_valid
                                   CHECK (kind IN ('code', 'tracker', 'document', 'person')),

  repository_id        integer,
  file_path            text,
  line_start           integer,
  line_end             integer,
  source_ref           text,

  plm_key              text,
  knowledge_source_id  integer,
  stated_by            text,

  created_at           timestamptz NOT NULL DEFAULT now(),

  -- Each kind carries the locator that makes it checkable. Code evidence with
  -- no path cannot be verified against anything and tracker evidence with no
  -- key cannot be followed, so neither of them is evidence.
  CONSTRAINT domain_rule_evidence_has_locator
    CHECK ((kind = 'code'     AND file_path           IS NOT NULL)
        OR (kind = 'tracker'  AND plm_key             IS NOT NULL)
        OR (kind = 'document' AND knowledge_source_id IS NOT NULL)
        OR (kind = 'person'   AND stated_by           IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS domain_rule_evidence_rule_idx ON domain_rule_evidence (rule_id);
-- The Phase 4 question, indexed now because it is why evidence is a table:
-- "which rules cite a file that just changed".
CREATE INDEX IF NOT EXISTS domain_rule_evidence_file_idx ON domain_rule_evidence (repository_id, file_path);
