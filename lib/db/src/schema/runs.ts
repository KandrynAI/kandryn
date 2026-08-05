import { pgTable, serial, text, integer, boolean, timestamp, index, jsonb } from "drizzle-orm/pg-core";
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
    // Veria review (0009_veria_review.sql). Both nullable — populated only when
    // the user runs Veria on a committed run.
    review: jsonb("review").$type<PersistedReviewResult | null>().default(null),
    reviewStatus: text("review_status").$type<ReviewStatus | null>().default(null),
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
