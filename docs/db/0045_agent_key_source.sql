-- 0045 — whose model credentials a run spent.
--
-- Additive and idempotent. Null means "created before this column existed",
-- which is not the same as "own": a backfill would claim knowledge the row
-- does not carry, and the cost reporting this column exists for must be able
-- to tell an unattributed historical run from an attributed one.
--
-- The source only. No key, and no fragment of a key, is ever written here.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS agent_key_source text;

-- Cost reporting reads "this user's Kandryn-funded runs since <time>", which is
-- also the predicate the daily cap counts on. Partial, because the rows that
-- matter are the funded minority.
CREATE INDEX IF NOT EXISTS runs_agent_key_source_idx
  ON runs (user_id, created_at)
  WHERE agent_key_source = 'kandryn';
