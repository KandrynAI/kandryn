import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suggestionsTable } from "./suggestions";

/**
 * One file within a suggestion's change set (Phase 0 multi-file scaffolding,
 * 0022). A suggestion currently always has exactly one row here; the table
 * exists so later phases can persist coordinated multi-file diffs. Mirrors
 * shared/types/codeSuggestion.ts SuggestionFile.
 */
export const suggestionFilesTable = pgTable(
  "suggestion_files",
  {
    id: serial("id").primaryKey(),
    suggestionId: integer("suggestion_id")
      .notNull()
      .references(() => suggestionsTable.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    op: text("op").$type<"create" | "edit" | "delete">().notNull(),
    filePath: text("file_path").notNull(),
    content: text("content").notNull(),
    // Search/replace hunks for an edit (Phase 1, 0023). Null for create/delete.
    hunks: jsonb("hunks").$type<Array<{ search: string; replace: string }> | null>(),
    // Git blob SHA of the source file read when the edit/delete was resolved
    // (Phase 1, 0023). Compared before commit to detect a branch that moved.
    sourceBlobSha: text("source_blob_sha"),
    // Structured, server-computed diff (Phase 1 PR2, 0024) — full-context hunks
    // with intraline ranges, so the client renders the diff without the original.
    diff: jsonb("diff"),
    resolved: boolean("resolved").notNull().default(false),
    applyStatus: text("apply_status")
      .$type<"pending" | "applied" | "failed">()
      .notNull()
      .default("pending"),
    applyError: text("apply_error"),
    // Why this file falls outside the change plan (Phase 2 PR2, 0026). Null for
    // planned files. Captured, not scored in this phase.
    deviationReason: text("deviation_reason"),
    linesAdded: integer("lines_added").notNull().default(0),
    linesRemoved: integer("lines_removed").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("suggestion_files_suggestion_seq_idx").on(t.suggestionId, t.seq),
    index("suggestion_files_suggestion_id_idx").on(t.suggestionId),
  ],
);

export const insertSuggestionFileSchema = createInsertSchema(suggestionFilesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSuggestionFile = z.infer<typeof insertSuggestionFileSchema>;
export type SuggestionFileRow = typeof suggestionFilesTable.$inferSelect;
