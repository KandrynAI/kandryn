-- Kandryn — the re-index claim  (migration 0047)
--
-- Two columns on `repositories` that turn graph_status = 'indexing' from a
-- state into a CLAIM.
--
-- WHY
--
-- Before this, `POST /repositories/:id/graph/rebuild` flipped the status to
-- 'indexing' and fired at the microservice with no duplicate guard at all, so
-- two clicks were two full clone-and-extract jobs on the customer's
-- repository. The obvious fix, refusing while the status is 'indexing', is
-- only safe with a timestamp: the status is resolved by a callback from the
-- microservice, and an index whose callback never arrives (service restarted,
-- extraction crashed, secret rotated) would otherwise leave the row 'indexing'
-- for ever and every future rebuild refused. The repository would become
-- permanently un-indexable with no way back through the UI.
--
-- So graph_started_at is what the guard reads, and a claim older than
-- INDEX_CLAIM_STALE_MINUTES (services/graphUsability.ts) is reclaimable. The
-- same shape ui_style_profiles.claimed_at (0042) uses, for the same reason.
--
-- graph_triggered_by records who asked. Needed because this action is moving
-- from owner-only to canAdminister in the same change: once a team admin can
-- re-index someone else's repository, "who started this" stops being obvious
-- from the row's user_id.
--
-- Both nullable: every existing row predates the claim, and a row whose index
-- was started before this migration simply reads as unclaimed, which is the
-- safe direction (a rebuild is allowed, not refused).
--
-- Additive and idempotent. Declared in lib/db/src/schema/repositories.ts as
-- well, so `drizzle-kit push` does not propose dropping them.

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS graph_started_at timestamptz;

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS graph_triggered_by text;
