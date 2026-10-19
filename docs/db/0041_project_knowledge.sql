-- Kandryn — project knowledge documents  (migration 0041)
--
-- Project Context part 1, PR-B: a customer can upload the architecture or
-- requirements documents they already have, and a run retrieves the passages
-- relevant to the work item it is implementing.
--
-- Two tables because the two things have different lifetimes. A source is the
-- document as uploaded — its name, type, size, where the object lives, and
-- whether parsing succeeded. A chunk is a retrievable passage of it. Deleting
-- the source takes its chunks with it (cascade), which is what makes "remove
-- this document" a complete answer.
--
-- Chunks are the ONLY place document text lives. Not the source row, not the
-- audit log, not the logs, not a run manifest.
--
-- `user_id` and `project_id` are denormalised onto chunks deliberately: the
-- retrieval query filters on both without a join, so the CLAUDE.md rule that
-- every query is scoped holds at the point it matters rather than one table
-- away. `tsv` is a stored generated column with a GIN index — core Postgres,
-- no extension, nothing session-dependent, so the Supabase pooler is fine.
--
-- No trigger is installed here, so the "drizzle-kit push does not create
-- triggers" trap (0033, 0038) does not apply to this migration.
--
-- Additive + idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id            serial       PRIMARY KEY,
  user_id       text         NOT NULL,
  project_id    integer      NOT NULL,
  doc_type      text         NOT NULL,              -- architecture | requirements | design | other
  title         text         NOT NULL,
  file_name     text         NOT NULL,
  mime_type     text         NOT NULL,
  size_bytes    integer      NOT NULL,
  storage_path  text         NOT NULL,
  content_hash  text,
  status        text         NOT NULL DEFAULT 'pending',   -- pending | parsing | ready | failed
  error         text,
  chunk_count   integer      NOT NULL DEFAULT 0,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  parsed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS knowledge_sources_project_idx
  ON knowledge_sources (user_id, project_id);

-- One upload of the same bytes per project. Partial, because a source whose
-- hash is not yet known (status 'pending') must not collide with another.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_hash_uq
  ON knowledge_sources (project_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id          serial   PRIMARY KEY,
  source_id   integer  NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  user_id     text     NOT NULL,
  project_id  integer  NOT NULL,
  seq         integer  NOT NULL,
  heading     text,
  page        integer,
  text        text     NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS (
                to_tsvector('english', coalesce(heading, '') || ' ' || text)
              ) STORED,
  UNIQUE (source_id, seq)
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_tsv_idx
  ON knowledge_chunks USING gin (tsv);

CREATE INDEX IF NOT EXISTS knowledge_chunks_project_idx
  ON knowledge_chunks (user_id, project_id);
