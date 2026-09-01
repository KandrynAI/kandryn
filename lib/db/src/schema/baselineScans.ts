import { pgTable, serial, integer, text, timestamp, numeric, index, check } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { repositoriesTable } from "./repositories";

/**
 * A baseline security scan of an existing codebase (0035).
 *
 * Not a run, and deliberately not stored on one. A run's Aegis scan gates a
 * change set about to merge; a baseline scan describes code that is already
 * there, so there is nothing to block and no gate state to record. Coverage
 * (`filesScanned` of `filesTotal`) is what an auditor needs instead.
 */
export const baselineScansTable = pgTable(
  "baseline_scans",
  {
    id: serial("id").primaryKey(),
    repositoryId: integer("repository_id")
      .notNull()
      .references((): AnyPgColumn => repositoriesTable.id, { onDelete: "cascade" }),
    // Plain ints (no .references()) to avoid a schema import cycle; the FKs
    // that matter live in the SQL migration.
    projectId: integer("project_id"),
    teamId: integer("team_id"),
    triggeredBy: text("triggered_by").notNull(),

    status: text("status").$type<BaselineScanStatus>().notNull().default("queued"),

    filesTotal: integer("files_total").notNull().default(0),
    filesScanned: integer("files_scanned").notNull().default(0),
    /** Excluded before scanning (binary, vendored, over the size cap). */
    filesSkipped: integer("files_skipped").notNull().default(0),

    criticalCount: integer("critical_count").notNull().default(0),
    highCount: integer("high_count").notNull().default(0),
    mediumCount: integer("medium_count").notNull().default(0),
    lowCount: integer("low_count").notNull().default(0),

    /** The Anthropic Message Batch backing this scan; the cron dispatcher polls it. */
    batchId: text("batch_id"),
    /** What the admin was shown and approved before any spend began. */
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 4 }),

    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("baseline_scans_repo_idx").on(t.repositoryId, t.createdAt),
    index("baseline_scans_team_idx").on(t.teamId, t.createdAt),
  ],
);

export type BaselineScanStatus = "queued" | "scanning" | "succeeded" | "failed" | "canceled";
export type BaselineFindingStatus = "open" | "acknowledged" | "pushed";

/**
 * One finding from a baseline scan. A row rather than an element of a jsonb
 * blob, because each is triaged on its own — acknowledged with a reason, or
 * pushed to the tracker — and matched against the next scan by fingerprint.
 */
export const baselineFindingsTable = pgTable(
  "baseline_findings",
  {
    id: serial("id").primaryKey(),
    scanId: integer("scan_id")
      .notNull()
      .references((): AnyPgColumn => baselineScansTable.id, { onDelete: "cascade" }),

    severity: text("severity").notNull(),
    owasp: text("owasp").notNull().default("Other"),
    filePath: text("file_path").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    lineRef: text("line_ref"),
    remediation: text("remediation").notNull().default(""),

    /**
     * hash(filePath, normalised title, owasp) — see `findingFingerprint`.
     * Excludes the line number on purpose: an edit elsewhere in the file shifts
     * every line below it, and a finding the team already triaged must not come
     * back as new.
     */
    fingerprint: text("fingerprint").notNull(),

    plmTicketKey: text("plm_ticket_key"),
    plmTicketUrl: text("plm_ticket_url"),

    status: text("status").$type<BaselineFindingStatus>().notNull().default("open"),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgeReason: text("acknowledge_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("baseline_findings_scan_idx").on(t.scanId),
    index("baseline_findings_fingerprint_idx").on(t.fingerprint),
    // Mirrors 0035. Declared here too, or `drizzle-kit push` creates the table
    // without it: a dismissal with no stated reason is not auditable.
    check(
      "baseline_findings_ack_has_reason",
      sql`${t.status} <> 'acknowledged' OR btrim(coalesce(${t.acknowledgeReason}, '')) <> ''`,
    ),
  ],
);

export type BaselineScan = typeof baselineScansTable.$inferSelect;
export type BaselineFinding = typeof baselineFindingsTable.$inferSelect;
