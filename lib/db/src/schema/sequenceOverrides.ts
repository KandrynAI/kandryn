import { pgTable, serial, integer, text, boolean, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { projectsTable } from "./projects";
import { runsTable } from "./runs";
import { sequenceChecksTable, type PersistedSequenceFinding, type PersistedImpactAnalysis } from "./sequenceChecks";

/**
 * An immutable record that a named user chose to run a work item out of order
 * (0038).
 *
 * Its own table rather than columns on `runs`, for the same reason
 * `aegis_overrides` (0034) is: a run is mutable and may be deleted, while the
 * whole value of this row is answering "what exactly was this person shown, and
 * what did they choose" months later. Everything the user saw is therefore
 * frozen here — the findings they acknowledged, the verbatim impact text, the
 * policy in force, the role they held — rather than referenced.
 *
 * A DB trigger blocks every UPDATE except the four ON DELETE SET NULL foreign
 * keys below, so deleting a run or a project leaves the record standing with
 * that column nulled. `work_item_key`/`work_item_title` are denormalised so the
 * row still reads correctly once `work_item_id` has gone null.
 *
 * Unlike an audit row, this is written SYNCHRONOUSLY in the same transaction as
 * the run it authorises: if the decision cannot be stored, the run does not
 * start.
 */
export const sequenceOverridesTable = pgTable(
  "sequence_overrides",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** Nullable: a personal project has no team. */
    teamId: integer("team_id"),
    /** The role held AT DECISION TIME. A later demotion must not rewrite what
     *  authority the decision was made under. */
    userRole: text("user_role").notNull(),
    workItemId: integer("work_item_id").references((): AnyPgColumn => tasksTable.id, {
      onDelete: "set null",
    }),
    workItemKey: text("work_item_key").notNull(),
    workItemTitle: text("work_item_title").notNull(),
    projectId: integer("project_id").references((): AnyPgColumn => projectsTable.id, {
      onDelete: "set null",
    }),
    runId: integer("run_id").references((): AnyPgColumn => runsTable.id, { onDelete: "set null" }),
    checkId: integer("check_id").references((): AnyPgColumn => sequenceChecksTable.id, {
      onDelete: "set null",
    }),
    verdictAtDecision: text("verdict_at_decision").notNull(),
    findingsAcknowledged: jsonb("findings_acknowledged")
      .$type<PersistedSequenceFinding[]>()
      .notNull()
      .default([]),
    /** The exact impact the user read, verbatim — not a reference to the check,
     *  which expires and may be pruned. */
    impactShown: jsonb("impact_shown").$type<PersistedImpactAnalysis>().notNull(),
    impactSource: text("impact_source").$type<"ai" | "deterministic">().notNull(),
    impactModel: text("impact_model"),
    reasonCategory: text("reason_category").notNull(),
    /** Required by the API when any finding is a warning; optional otherwise. */
    reasonText: text("reason_text"),
    acknowledgedImpact: boolean("acknowledged_impact").notNull(),
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    recordHash: text("record_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sequence_overrides_team_idx").on(t.teamId, t.createdAt),
    index("sequence_overrides_user_idx").on(t.userId, t.createdAt),
    index("sequence_overrides_item_idx").on(t.workItemId),
    index("sequence_overrides_run_idx").on(t.runId),
    check("sequence_overrides_impact_source_check", sql`${t.impactSource} IN ('ai','deterministic')`),
  ],
);

export type SequenceOverride = typeof sequenceOverridesTable.$inferSelect;
