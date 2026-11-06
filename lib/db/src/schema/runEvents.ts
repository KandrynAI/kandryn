import { pgTable, serial, integer, bigint, text, jsonb, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { runsTable } from "./runs";
import { projectsTable } from "./projects";

/**
 * The live run timeline (migration 0044).
 *
 * One row per structured step an agent took, in order, for both the live feed
 * and the replayable record of a finished run. The contract — the unions, the
 * per-type data shapes, the size caps — lives in `shared/types/runEvent.ts`;
 * enforcement lives in the API server's `runEventCore.ts`. Rows are only ever
 * inserted, never updated.
 *
 * CONTENT-FREE BY CONSTRUCTION. `summary` is built server-side from a template
 * over allowlisted scalars, and `data` is filtered to an allowlist per type, so
 * no work item text, document text, diff, prompt or model output can reach this
 * table. It is the same rule `runs.context_manifest` (0040) follows.
 *
 * SCOPING mirrors `runs`: `user_id` (the project owner) + `project_id`. There is
 * deliberately no `team_id`, because `runs` has none — team visibility is
 * derived from `projects.team_id`, and a second copy of that fact here could
 * disagree with it. Both columns are denormalised rather than joined through
 * the run on every read, the precedent `knowledge_chunks` set in 0041.
 *
 * NO HASH-CHAIN TRIGGER, unlike `audit_log` (0033). That trigger serializes
 * inserts on a team's chain head, which is tolerable for a few audit rows per
 * action and not for ~80 events per run. This table is evidence by retention
 * and insert-only convention, not by chaining.
 *
 * `seq` IS THE CURSOR, and it is claimed from `runs.event_seq` inside the
 * insert's own transaction. Nothing else is safe: a global sequence (or the
 * serial `id`) is allocated outside the transaction, so a writer that takes a
 * lower number and commits later lands behind a reader's cursor and is never
 * delivered. Measured — see docs/investigations/live-run-timeline.md §8.1.
 */
export const runEventsTable = pgTable(
  "run_events",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runsTable.id, { onDelete: "cascade" }),
    /** The project owner, as on `runs`. Denormalised so a read filters without a join. */
    userId: text("user_id").notNull(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    /**
     * Monotonic per run and equal to commit order. `bigint` with
     * `mode: "number"` because a run will never approach 2^53 events and the
     * client compares it as a number.
     */
    seq: bigint("seq", { mode: "number" }).notNull(),
    agent: text("agent").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    /** Template-built, <=160 chars. Never interpolated from untrusted text. */
    summary: text("summary").notNull(),
    /** Allowlisted keys per type only, size-capped. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set on completion events (`stage.completed`, `run.completed`, …). */
    durationMs: integer("duration_ms"),
  },
  (t) => [
    /**
     * The cursor index, and the guard that makes a double-claim loud (23505)
     * instead of silently reordering the timeline.
     */
    uniqueIndex("run_events_run_seq_uq").on(t.runId, t.seq),
    index("run_events_user_created_idx").on(t.userId, t.createdAt),
    check(
      "run_events_agent_check",
      sql`${t.agent} IN ('raptia','fovea','synthesia','veria','aegis','narratia','system')`,
    ),
    check(
      "run_events_status_check",
      sql`${t.status} IN ('started','ok','warn','failed','info')`,
    ),
    check(
      "run_events_type_check",
      sql`${t.type} IN ('run.started','run.completed','run.failed','stage.started','stage.completed','stage.failed','context.read','plan.step','file.write','check.result','score.dimension','runbook.section','gate.result')`,
    ),
  ],
);

export type RunEventRow = typeof runEventsTable.$inferSelect;
export type NewRunEventRow = typeof runEventsTable.$inferInsert;
