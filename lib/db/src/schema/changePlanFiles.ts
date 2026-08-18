import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { changePlansTable } from "./changePlans";

/**
 * One planned file within a change plan (Phase 2 PR1). `seq` is dependency order
 * (types/DTOs → interfaces → implementations → controllers → frontend) and drives
 * both display and generation order — not commit order (commit stays atomic).
 */
export const changePlanFilesTable = pgTable(
  "change_plan_files",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .notNull()
      .references(() => changePlansTable.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    op: text("op").$type<"create" | "edit" | "delete">().notNull(),
    filePath: text("file_path").notNull(),
    // One user-facing line, e.g. "declare EndorseAsync".
    rationale: text("rationale").notNull(),
    // Optional methods/types to add or change.
    symbols: jsonb("symbols").$type<string[] | null>(),
    addedByUser: boolean("added_by_user").notNull().default(false),
    // 'autocomplete' | 'manual' — set only when addedByUser. Manual entry of a
    // path never in candidate_files is the strongest signal retrieval failed.
    addedSource: text("added_source").$type<"autocomplete" | "manual" | null>(),
    // Was this path in change_plans.candidate_files? Attributes a user-added file
    // to a planner miss (true) vs a retrieval miss (false).
    inCandidates: boolean("in_candidates"),
  },
  (t) => [
    uniqueIndex("change_plan_files_plan_seq_idx").on(t.planId, t.seq),
    index("change_plan_files_plan_id_idx").on(t.planId),
  ],
);

export const insertChangePlanFileSchema = createInsertSchema(changePlanFilesTable).omit({
  id: true,
});
export type InsertChangePlanFile = z.infer<typeof insertChangePlanFileSchema>;
export type ChangePlanFileRow = typeof changePlanFilesTable.$inferSelect;
