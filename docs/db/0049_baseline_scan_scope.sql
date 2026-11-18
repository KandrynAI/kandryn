-- Kandryn — scoping a baseline scan to a folder  (migration 0049)
--
-- WHY
--
-- A baseline scan refuses above MAX_FILES (5,000) scannable files, which is
-- the right refusal: a scan that size is a conversation, not a click. But it
-- left the largest repositories with no path at all, when those are exactly
-- the ones where a security scan is worth most. A folder at a time makes them
-- scannable, and makes a re-scan of the part that changed affordable.
--
-- WHY IT IS STORED RATHER THAN JUST APPLIED
--
-- The findings describe this subtree and nothing else. Someone comparing two
-- scans of the same repository has to be able to see that one of them looked
-- at a tenth of it, or "fewer findings than last time" reads as progress when
-- it is a narrower question. file_paths already records exactly what was read;
-- path_prefix records what was ASKED for, which is what a reader recognises.
--
-- Null means the whole repository, which is every scan that already exists.
--
-- Additive and idempotent. Declared in lib/db/src/schema/baselineScans.ts as
-- well, so `drizzle-kit push` does not propose dropping it.

ALTER TABLE baseline_scans
  ADD COLUMN IF NOT EXISTS path_prefix text;
