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
    // Structured diff hunks — null until a later phase populates them.
    hunks: jsonb("hunks"),
    resolved: boolean("resolved").notNull().default(false),
    applyStatus: text("apply_status")
      .$type<"pending" | "applied" | "failed">()
      .notNull()
      .default("pending"),
    applyError: text("apply_error"),
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
