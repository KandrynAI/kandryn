-- ============================================================================
-- Kandryn — Projects, PLM hierarchy, and Runs  (migration 0001)
-- ============================================================================
-- Incremental DDL for an EXISTING database that already has:
--   repositories, tasks, integration_configs, waitlist
--
-- Two ways to apply:
--   A) Preferred — run against the DIRECT (port 5432, NOT the pooled 6543) URL:
--        DATABASE_URL="<direct 5432 url>" pnpm run db:migrate
--      (drizzle-kit push diffs the live DB against the schema and applies the delta.)
--   B) Manual — paste this whole script into the Supabase SQL editor and run it.
--
-- Idempotent: uses IF NOT EXISTS + duplicate_object guards, so a re-run is a no-op.
-- This only creates NEW tables/columns/indexes; it never alters existing data.
-- ============================================================================

BEGIN;

-- 1. projects -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "projects" (
  "id"               serial PRIMARY KEY NOT NULL,
  "user_id"          text NOT NULL,
  "name"             text NOT NULL,
  "plm_provider"     text NOT NULL,          -- 'jira' | 'azure-devops'
  "plm_project_key"  text,                   -- null only for legacy/migrated rows
  "plm_project_name" text,
  "repository_id"    integer NOT NULL,
  "default_target"   text DEFAULT 'task' NOT NULL,  -- 'story' | 'task'
  "last_synced_at"   timestamp with time zone,
  "created_at"       timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "projects_repository_id_repositories_id_fk"
    FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE restrict
);
CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "projects_user_plm_key_idx"
  ON "projects" ("user_id","plm_provider","plm_project_key");

-- 2. tasks: new columns + FKs + indexes --------------------------------------
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "project_id"      integer;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_id"       integer;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "item_type"       text DEFAULT 'task' NOT NULL; -- epic|story|task|bug|test_case
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "plm_url"         text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "plm_updated_at"  timestamp with time zone;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "plm_status"      text;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk"
    FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "tasks_project_id_idx" ON "tasks" ("project_id");
CREATE INDEX IF NOT EXISTS "tasks_parent_id_idx"  ON "tasks" ("parent_id");

-- 3. runs ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "runs" (
  "id"            serial PRIMARY KEY NOT NULL,
  "user_id"       text NOT NULL,
  "project_id"    integer NOT NULL,
  "work_item_id"  integer NOT NULL,
  "status"        text NOT NULL,   -- scheduled|queued|running|succeeded|failed|canceled
  "trigger"       text NOT NULL,   -- manual|scheduled
  "refine_prompt" text,
  "auto_commit"   boolean DEFAULT false NOT NULL,
  "scheduled_at"  timestamp with time zone,
  "started_at"    timestamp with time zone,
  "finished_at"   timestamp with time zone,
  "error"         text,
  "pr_url"        text,
  "commit_hash"   text,
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runs_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade,
  CONSTRAINT "runs_work_item_id_tasks_id_fk"
    FOREIGN KEY ("work_item_id") REFERENCES "public"."tasks"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "runs_user_id_idx"          ON "runs" ("user_id");
CREATE INDEX IF NOT EXISTS "runs_status_scheduled_idx" ON "runs" ("status","scheduled_at");

-- 4. suggestions --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "suggestions" (
  "id"             serial PRIMARY KEY NOT NULL,
  "run_id"         integer NOT NULL,
  "agent"          text NOT NULL,   -- claude|openai|copilot|antigravity
  "code"           text NOT NULL,
  "explanation"    text NOT NULL,
  "file_path"      text NOT NULL,
  "language"       text NOT NULL,
  "score"          integer,
  "recommendation" text,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "suggestions_run_id_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "suggestions_run_id_idx" ON "suggestions" ("run_id");

COMMIT;

-- ============================================================================
-- DML / backfill: NOT required to apply the schema. Existing `tasks` rows keep
-- working (new columns are nullable; item_type defaults to 'task'). Backfilling
-- old tasks into projects (setting project_id) is only needed if you have
-- pre-existing task data you want visible in the new project board. That step
-- is handled by the application-layer backfill delivered with the projects API
-- (Phase 1) and is idempotent — no manual DML needed here.
-- ============================================================================
