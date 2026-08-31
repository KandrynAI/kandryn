import { pgTable, serial, integer, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { runsTable, type PersistedAegisFinding } from "./runs";

/**
 * An audited override of a blocked Aegis security gate (0034).
 *
 * Its own table rather than columns on `runs`, because a run can be re-scanned
 * — `runs.security_scan` is overwritten in place. The whole value of this record
 * is answering "what exactly was overridden, and why" months later, so the
 * findings are frozen here at override time rather than referenced.
 *
 * Every row is also mirrored to the audit log as `aegis.gate_overridden`; this
 * table is the queryable source for the reporting tiers.
 */
export const aegisOverridesTable = pgTable(
  "aegis_overrides",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references((): AnyPgColumn => runsTable.id, { onDelete: "cascade" }),
    suggestionId: integer("suggestion_id"),
    // Plain ints (no Drizzle .references()) to avoid a schema import cycle; the
    // FKs live in the SQL migration.
    projectId: integer("project_id"),
    teamId: integer("team_id"),

    /** The real authenticated Clerk user who cleared the gate — never a role. */
    overriddenBy: text("overridden_by").notNull(),
    /** runs.run_by_user_id at override time. Null on runs predating 0032. */
    triggeredBy: text("triggered_by"),
    /**
     * Denormalised self-override flag for reporting. Null when the trigger
     * identity is unknown, which is distinct from a known-different actor.
     */
    sameActor: boolean("same_actor"),
    /**
     * Whether projects.require_second_approver was on at the time. Records which
     * rule was in force so a later toggle doesn't rewrite history.
     */
    secondApproverRequired: boolean("second_approver_required").notNull().default(false),

    /** Mandatory. Trimmed non-empty, enforced in the API and by a CHECK. */
    reason: text("reason").notNull(),

    /** The gate's verbatim reason: coverage (unscanned) vs findings. */
    gateReason: text("gate_reason"),
    findingsSnapshot: jsonb("findings_snapshot")
      .$type<PersistedAegisFinding[]>()
      .notNull()
      .default([]),
    criticalCount: integer("critical_count").notNull().default(0),
    highCount: integer("high_count").notNull().default(0),
    unscannedCount: integer("unscanned_count").notNull().default(0),
    unscannedFiles: jsonb("unscanned_files").$type<string[]>().notNull().default([]),

    /**
     * Did the GitHub status check actually flip to success? False for a
     * non-GitHub repo or a missing token — the override is still recorded, but
     * it had no external effect and the UI must not imply otherwise.
     */
    statusReposted: boolean("status_reposted").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("aegis_overrides_run_idx").on(t.runId),
    index("aegis_overrides_team_idx").on(t.teamId, t.createdAt),
  ],
);

export type AegisOverride = typeof aegisOverridesTable.$inferSelect;
