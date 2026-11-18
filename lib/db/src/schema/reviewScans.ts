import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  numeric,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The whole-repository code review (0051).
 *
 * Deliberately its OWN tables rather than a `kind` column on baseline_scans.
 * The two share their execution machinery (one Message Batch, collected by the
 * cron tick) because that is about surviving a 300-second function, and
 * nothing else about them is the same: a different prompt, a different
 * taxonomy, a different severity scale with no `critical`, a different reader.
 * A shared table would have meant a `kind` discriminator on every query, a
 * fingerprint that has to include it, and a triage UI that filters before it
 * can say anything true. Nothing already shipped is touched this way.
 *
 * Unions are inlined rather than imported: lib/db is a composite project
 * rooted at src/ and cannot reach ../../../../shared. shared/types/reviewScan.ts
 * is the source of truth.
 */
export const reviewScansTable = pgTable(
  "review_scans",
  {
    id: serial("id").primaryKey(),
    repositoryId: integer("repository_id").notNull(),
    projectId: integer("project_id"),
    teamId: integer("team_id"),
    triggeredBy: text("triggered_by").notNull(),

    status: text("status")
      .$type<"queued" | "scanning" | "succeeded" | "failed">()
      .notNull()
      .default("queued"),

    filesTotal: integer("files_total").notNull().default(0),
    filesReviewed: integer("files_reviewed").notNull().default(0),
    /** Excluded before reviewing, or whose reply could not be read. */
    filesSkipped: integer("files_skipped").notNull().default(0),

    highCount: integer("high_count").notNull().default(0),
    mediumCount: integer("medium_count").notNull().default(0),
    lowCount: integer("low_count").notNull().default(0),

    /**
     * The ordered file list this review's batch was built from, frozen at
     * submit. A request's `custom_id` is `f<index>` into THIS array and it is
     * never re-derived: the lesson 0036 paid for on the security scan, where
     * re-deriving the list attributed findings to whatever file had drifted
     * into the slot after a push.
     */
    filePaths: jsonb("file_paths").$type<string[]>().notNull().default([]),
    /** The folder this review was limited to. Null is the whole repository. */
    pathPrefix: text("path_prefix"),

    batchId: text("batch_id"),
    model: text("model"),

    /** What the admin was shown and approved before any spend began. */
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 4 }),
    /** What it actually cost, from the tokens the provider reported. */
    actualCostUsd: numeric("actual_cost_usd", { precision: 10, scale: 4 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_scans_repo_idx").on(t.repositoryId),
    index("review_scans_status_idx").on(t.status),
    // Declared here as well as in the migration, or `drizzle-kit push` creates
    // the table without it (the trap 0041 documented).
    check(
      "review_scans_status_valid",
      sql`${t.status} IN ('queued', 'scanning', 'succeeded', 'failed')`,
    ),
  ],
);

/**
 * One finding, as its own row rather than a blob on the scan.
 *
 * Each is triaged on its own, acknowledged with a reason, and matched against
 * the next review by fingerprint, which a jsonb array cannot support.
 */
export const reviewFindingsTable = pgTable(
  "review_findings",
  {
    id: serial("id").primaryKey(),
    scanId: integer("scan_id")
      .notNull()
      .references((): AnyPgColumn => reviewScansTable.id, { onDelete: "cascade" }),

    severity: text("severity").$type<"high" | "medium" | "low">().notNull(),
    category: text("category").notNull().default("other"),
    filePath: text("file_path").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    lineRef: text("line_ref"),
    remediation: text("remediation").notNull().default(""),

    /** hash(filePath, normalised title, category). Excludes the line number. */
    fingerprint: text("fingerprint").notNull(),

    status: text("status").$type<"open" | "acknowledged">().notNull().default("open"),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgeReason: text("acknowledge_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("review_findings_scan_idx").on(t.scanId),
    index("review_findings_fingerprint_idx").on(t.fingerprint),
    // A dismissal with no stated reason is indistinguishable from one nobody
    // looked at, and it is carried forward silently into every later review.
    // The same constraint baseline_findings carries, for the same reason.
    check(
      "review_findings_ack_has_reason",
      sql`${t.status} <> 'acknowledged' OR btrim(coalesce(${t.acknowledgeReason}, '')) <> ''`,
    ),
    check("review_findings_severity_valid", sql`${t.severity} IN ('high', 'medium', 'low')`),
  ],
);

export type ReviewScan = typeof reviewScansTable.$inferSelect;
export type ReviewFinding = typeof reviewFindingsTable.$inferSelect;
