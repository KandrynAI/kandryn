-- 0033_audit_hash_chain.sql — Governance item 7: tamper-evident audit log.
--
-- A per-team hash chain computed IN THE DATABASE at write time (pgcrypto is
-- enabled in 0017), so the chain cannot be bypassed by application code. Each
-- row's row_hash = sha256(prev_row_hash || canonical content); tampering with or
-- deleting a row breaks the chain and is caught by audit_log_verify().
--
-- Additive + idempotent. The chain starts from the first row inserted AFTER this
-- migration — existing rows are not retroactively chained (a documented
-- baseline; a hash backfill would require a separate one-time pass).
--
-- NOTE: these functions/trigger could not be executed in the build sandbox (no
-- Postgres server). Apply on a Supabase branch first and smoke-test — perform an
-- audited action, then `SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1;`
-- and `SELECT * FROM audit_log_verify(<team_id>);` — before applying to prod.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS row_hash  text;

-- Single source of truth for the per-row digest, shared by the write trigger and
-- the verifier so their serialization can never drift. jsonb::text is canonical
-- (deterministic key ordering), so metadata hashes stably.
CREATE OR REPLACE FUNCTION audit_log_row_digest(
  p_prev text, p_id integer, p_team integer, p_user text, p_action text,
  p_etype text, p_eid integer, p_meta jsonb, p_ip text, p_ua text, p_created timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(
    coalesce(p_prev, '')       || '|' ||
    coalesce(p_id::text, '')   || '|' ||
    coalesce(p_team::text, '') || '|' ||
    coalesce(p_user, '')       || '|' ||
    coalesce(p_action, '')     || '|' ||
    coalesce(p_etype, '')      || '|' ||
    coalesce(p_eid::text, '')  || '|' ||
    coalesce(p_meta::text, '') || '|' ||
    coalesce(p_ip, '')         || '|' ||
    coalesce(p_ua, '')         || '|' ||
    coalesce(p_created::text, '')
  , 'sha256'), 'hex')
$$;

-- BEFORE INSERT: link each new row to its team's previous row. A per-team
-- advisory lock serializes concurrent writes within a chain (incl. the genesis
-- row), so the head is read consistently under concurrency.
CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_chain:' || coalesce(NEW.team_id::text, 'orphan')));

  SELECT row_hash INTO v_prev
  FROM audit_log
  WHERE team_id IS NOT DISTINCT FROM NEW.team_id
  ORDER BY id DESC
  LIMIT 1;

  NEW.prev_hash := v_prev;
  NEW.row_hash := audit_log_row_digest(
    v_prev, NEW.id, NEW.team_id, NEW.user_id, NEW.action, NEW.entity_type,
    NEW.entity_id, NEW.metadata, NEW.ip_address, NEW.user_agent, NEW.created_at
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_chain_trg ON audit_log;
CREATE TRIGGER audit_log_chain_trg
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- Verifier: walk a team's chain in id order, recompute each row's hash from the
-- ACTUAL previous retained row, and return the first row that fails (tampered, or
-- a deleted predecessor). The earliest retained row trusts its stored prev_hash —
-- its predecessor may have been purged by retention, a legitimate gap, not
-- tampering. Only hash-bearing rows (post-baseline) are checked.
CREATE OR REPLACE FUNCTION audit_log_verify(p_team integer)
RETURNS TABLE(ok boolean, first_broken_id integer, rows_checked bigint)
LANGUAGE sql STABLE AS $$
  WITH chain AS (
    SELECT id, team_id, user_id, action, entity_type, entity_id, metadata,
           ip_address, user_agent, created_at, row_hash, prev_hash,
           lag(row_hash)  OVER (ORDER BY id) AS actual_prev,
           row_number()   OVER (ORDER BY id) AS rn
    FROM audit_log
    WHERE team_id IS NOT DISTINCT FROM p_team AND row_hash IS NOT NULL
  ),
  recomputed AS (
    SELECT id,
      audit_log_row_digest(
        CASE WHEN rn = 1 THEN prev_hash ELSE actual_prev END,
        id, team_id, user_id, action, entity_type, entity_id, metadata,
        ip_address, user_agent, created_at
      ) AS expected,
      row_hash
    FROM chain
  ),
  broken AS (
    SELECT id FROM recomputed WHERE expected IS DISTINCT FROM row_hash ORDER BY id LIMIT 1
  )
  SELECT
    NOT EXISTS (SELECT 1 FROM broken)  AS ok,
    (SELECT id FROM broken)            AS first_broken_id,
    (SELECT count(*) FROM chain)       AS rows_checked;
$$;
