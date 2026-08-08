import { pgTable, serial, text, integer, boolean, timestamp, index, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";
import { tasksTable } from "./tasks";

export type RunStatus =
  | "scheduled"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type ReviewStatus = "pending" | "running" | "done" | "failed";

/**
 * Veria review result, persisted on the run. Mirrors
 * shared/types/reviewResult.ts (kept local because lib/db is a composite
 * project rooted at src/ and cannot import from ../../../../shared).
 */
export interface PersistedReviewFinding {
  type: "strength" | "gap" | "risk";
  title: string;
  detail: string;
  acRef?: string;
  severity?: "low" | "medium" | "high";
}
export interface PersistedReviewResult {
  summary: string;
  acCoverage: { covered: string[]; missed: string[]; partial: string[] };
  findings: PersistedReviewFinding[];
  reviewerNote: string;
  generatedAt: string;
}

/**
 * Aegis security scan result, persisted on the run. Mirrors
 * shared/types/aegisResult.ts (kept local because lib/db is a composite project
 * rooted at src/ and cannot import from ../../../../shared).
 */
export interface PersistedAegisFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  owasp: string;
  title: string;
  detail: string;
  lineRef?: string;
  remediation: string;
  cveRef?: string;
  plmTicketUrl?: string;
  plmTicketKey?: string;
  pushedToBoard?: boolean;
  remediationRunId?: number;
  remediationStatus?: "pending" | "running" | "committed" | "failed";
}
export interface PersistedAegisScanResult {
  summary: string;
  findings: PersistedAegisFinding[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  gateDecision: "approved" | "blocked";
  gateReason: string;
  scannedFile: string;
  generatedAt: string;
}

/**
 * A durable execution of the agent pipeline against a work item. Every run
 * (manual or scheduled) is a row here so background/scheduled runs have somewhere
 * to persist results (there is no HTTP response to return to).
 */
export const runsTable = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    workItemId: integer("work_item_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    status: text("status").$type<RunStatus>().notNull(),
    trigger: text("trigger").$type<"manual" | "scheduled">().notNull(),
    refinePrompt: text("refine_prompt"),
    autoCommit: boolean("auto_commit").notNull().default(false),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    prUrl: text("pr_url"),
    commitHash: text("commit_hash"),
    // The suggestion that was committed (auto or manual). Plain pointer, no FK
    // constraint — declaring one here would create a runs<->suggestions import
    // cycle in the schema. Consumers null-check it. Used by test generation to
    // recover the chosen suggestion's code.
    committedSuggestionId: integer("committed_suggestion_id"),
    // Whether this run's code context came from the Graphify knowledge graph
    // (precise, low-token) rather than the keyword fallback (0011_run_graph_context.sql).
    usedGraphContext: boolean("used_graph_context").notNull().default(false),
    // Human-readable stack this run targeted, e.g. "react · nodejs · postgresql"
    // (0013_run_stack.sql). Null for runs created before the column existed.
    stackDesc: text("stack_desc"),
    // Veria review (0009_veria_review.sql). Both nullable — populated only when
    // the user runs Veria on a committed run.
    review: jsonb("review").$type<PersistedReviewResult | null>().default(null),
    reviewStatus: text("review_status").$type<ReviewStatus | null>().default(null),
    // Aegis security scan (0014_aegis.sql). All nullable — populated only when
    // the user runs Aegis on a committed run.
    securityScan: jsonb("security_scan").$type<PersistedAegisScanResult | null>().default(null),
    securityScanStatus: text("security_scan_status")
      .$type<"pending" | "running" | "done" | "failed" | "skipped" | null>()
      .default(null),
    securityGate: text("security_gate").$type<"approved" | "blocked" | "pending" | null>().default(null),
    // Narratia runbook (0015_narratia.sql). Populated only when the user
    // generates a runbook for a committed run.
    runbook: text("runbook"),
    runbookStatus: text("runbook_status")
      .$type<"pending" | "running" | "done" | "failed" | null>()
      .default(null),
    runbookTarget: text("runbook_target"), // 'markdown' | 'confluence' | 'notion'
    runbookUrl: text("runbook_url"), // URL after push (confluence/notion/markdown)
    // Aegis remediation (0016_aegis_remediation.sql). For a remediation run,
    // parentRunId points at the run whose Aegis scan produced the finding.
    parentRunId: integer("parent_run_id").references((): AnyPgColumn => runsTable.id, {
      onDelete: "set null",
    }),
    triggerContext: text("trigger_context"), // manual|scheduled|remediation|breakdown
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("runs_user_id_idx").on(t.userId),
    // Dispatcher query: scheduled runs that are due, ordered by time.
    index("runs_status_scheduled_idx").on(t.status, t.scheduledAt),
  ],
);

export const insertRunSchema = createInsertSchema(runsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runsTable.$inferSelect;
