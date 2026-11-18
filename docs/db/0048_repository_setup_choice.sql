-- Kandryn — the setup choice at connect  (migration 0048)
--
-- What a customer asked Kandryn to do with a repository when they connected
-- it, and whether that has been acted on yet.
--
-- WHY TWO PLACES
--
-- The question is asked in two places because the repository does not exist
-- when the project wizard runs. `POST /repositories` requires a projectId, so
-- on the common path a new customer finishes the wizard with nothing to pick:
-- the project is created first and the repository is connected from the board
-- afterwards. So projects.setup_choice is a DEFAULT, remembered so the connect
-- form arrives with the answer already selected, and repositories.setup_choice
-- is the INSTRUCTION, acted on once and then stamped.
--
-- WHY A COMPLETION STAMP RATHER THAN CLEARING THE CHOICE
--
-- The dispatcher is what acts on `index_scan`, because a baseline scan cannot
-- be started from the connect request: it resolves the owner's model key,
-- submits a batch and is collected minutes later. Clearing setup_choice once
-- it had run would destroy the record of what was asked for, which is the one
-- thing an auditor wants when a scan appears that nobody remembers starting.
-- So the choice stays and setup_completed_at says it has been honoured.
--
-- NO ENUM TYPE, and no CHECK constraint. The values are validated in the
-- application (shared/types/repoSetup.ts) and an unrecognised value reads back
-- as the default rather than as "do nothing", so a column written by a newer
-- deploy cannot turn into a silent no-op on an older one. A CHECK here would
-- instead make that case a 500 on the write path.
--
-- graph_status gains a sixth value, `queued`, with no DDL: it is a text
-- column. A trigger that could not reach the Graphify microservice parks there
-- and the cron dispatcher drains it, so an index no longer depends on the
-- request that asked for it surviving.
--
-- Additive and idempotent. All three columns are declared in
-- lib/db/src/schema/{repositories,projects}.ts as well, so `drizzle-kit push`
-- does not propose dropping them.

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS setup_choice text;

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz;

-- Why the chosen setup could not be honoured, in words a customer reads. Set
-- together with setup_completed_at: a refusal (no model key, above the file
-- cap, a scan already running) is a final answer, not something to retry on
-- every tick for ever.
ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS setup_error text;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS setup_choice text;

-- Every repository that already exists was connected under the old behaviour,
-- which always indexed and never scanned, and has already had whatever index
-- it is going to get. Stamping them as completed keeps the dispatcher's
-- pending-setup sweep off rows it has nothing to do for. NULL setup_choice
-- reads as the default ('index') in the application, so this says "already
-- indexed, nothing further asked for" rather than inventing a choice.
UPDATE repositories
   SET setup_completed_at = now()
 WHERE setup_completed_at IS NULL
   AND setup_choice IS NULL;
