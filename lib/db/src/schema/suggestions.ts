import { pgTable, serial, text, integer, timestamp, index, jsonb } from "drizzle-orm/pg-core";
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
    code: text("code").notNull(),
    explanation: text("explanation").notNull(),
    filePath: text("file_path").notNull(),
    language: text("language").notNull(),
    score: integer("score"),
    recommendation: text("recommendation"),
    testCases: jsonb("test_cases").$type<PersistedTestCase[]>().notNull().default([]),
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
