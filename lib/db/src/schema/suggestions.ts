import { pgTable, serial, text, integer, boolean, numeric, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { runsTable } from "./runs";

/**
 * Persisted rich test case (mirrors shared/types/testCase.ts, minus the
 * client-only `selected` flag). Defined locally because lib/db is a composite
 * project rooted at src/ and cannot import from ../../../../shared.
 */
export interface PersistedTestCase {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  type: "happy-path" | "edge-case" | "failure";
  given: string;
  when: string;
  then: string;
  assertion: string;
  tags: string[];
  // Set once the case has been pushed to the PLM (0012). Their presence marks
  // the case as "Pushed" in the UI across reloads.
  plmKey?: string;
  plmUrl?: string;
}

/** Persisted test script (0012) — the runnable file committed to the PR. */
export interface PersistedTestScript {
  filePath: string;
  code: string;
  framework: string;
}

/** Mirrors shared/types/coherence.ts CoherenceFinding (0028, local for the composite build). */
export interface PersistedCoherenceFinding {
  check: "interface_impl" | "type_resolution" | "caller_callee" | "imports";
  severity: "error" | "warning";
  filePath: string;
  line?: number;
  message: string;
  relatedFilePath?: string;
}

/** Mirrors shared/types/scoreBreakdown.ts (kept local for the composite build). */
export interface PersistedScoreDimension {
  score: number;
  weight: number;
  verdict: "strong" | "adequate" | "weak";
  reason: string;
}
export interface PersistedScoreBreakdown {
  correctness: PersistedScoreDimension;
  readability: PersistedScoreDimension;
  minimalDiff: PersistedScoreDimension;
  conventions: PersistedScoreDimension;
  acCoverage: PersistedScoreDimension;
  coherence?: PersistedScoreDimension; // static coherence (Phase 3), injected

  // Behaviour signals (weight 0 — informational). Optional for older runs.
  ambiguityHandling?: PersistedScoreDimension;
  surgicalPrecision?: PersistedScoreDimension;
  overallNarrative: string;
  recommendation: "Recommended" | "Alternative";
  confidence: number;
  confidenceReason: string;
}

/**
 * A persisted agent suggestion produced by a run. Mirrors the CodeSuggestion
 * shape (shared/types/codeSuggestion.ts) so runs can be committed from later.
 */
export const suggestionsTable = pgTable(
  "suggestions",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runsTable.id, { onDelete: "cascade" }),
    agent: text("agent").$type<"claude" | "openai" | "copilot" | "antigravity">().notNull(),
    // @deprecated (0022) — the change set now lives in suggestion_files (one row
    // per file). Nullable and no longer written; kept for rollback safety. Read
    // a suggestion's files via `suggestion_files WHERE suggestion_id=…`.
    code: text("code"),
    explanation: text("explanation").notNull(),
    // @deprecated (0022) — see `code`. Resolve the file(s) via suggestion_files.
    filePath: text("file_path"),
    language: text("language").notNull(),
    score: integer("score"),
    recommendation: text("recommendation"),
    testCases: jsonb("test_cases").$type<PersistedTestCase[]>().notNull().default([]),
    testScript: jsonb("test_script").$type<PersistedTestScript | null>(),
    scoreBreakdown: jsonb("score_breakdown").$type<PersistedScoreBreakdown | null>(),
    scoreNarrative: text("score_narrative"),
    // Superseded by a later plan revision's regeneration (Phase 2 PR3, 0027).
    // Retained (never deleted) so a prior revision stays readable; the run detail
    // shows only non-superseded suggestions.
    superseded: boolean("superseded").notNull().default(false),
    // Static coherence check (Phase 3, 0028). Score 0–1; status passed|warnings|
    // failed; findings mirror shared/types/coherence.ts CoherenceFinding.
    coherenceScore: numeric("coherence_score"),
    coherenceStatus: text("coherence_status").$type<"passed" | "warnings" | "failed" | null>(),
    coherenceFindings: jsonb("coherence_findings").$type<PersistedCoherenceFinding[] | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("suggestions_run_id_idx").on(t.runId)],
);

export const insertSuggestionSchema = createInsertSchema(suggestionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSuggestion = z.infer<typeof insertSuggestionSchema>;
export type Suggestion = typeof suggestionsTable.$inferSelect;
