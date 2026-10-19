import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { repositoriesTable } from "./repositories";
import { projectsTable } from "./projects";

/**
 * `tasks` is the physical table for work items (kept named `tasks` to minimize
 * migration risk). New columns below add the project binding + PLM hierarchy.
 *
 * Migration note: `project_id` and the PLM columns are nullable for the initial
 * backfill; a follow-up migration enforces NOT NULL on `project_id` once the
 * backfill is verified. `type` is retained for backward compatibility and will
 * be folded into `item_type` in a later migration.
 */
export const tasksTable = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    externalId: text("external_id"),
    source: text("source").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    acceptanceCriteria: text("acceptance_criteria"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    linkedCommit: text("linked_commit"),
    repositoryId: integer("repository_id").references(() => repositoriesTable.id, {
      onDelete: "set null",
    }),

    // --- Project + hierarchy (Projects / PLM-hierarchy feature) ---
    projectId: integer("project_id").references(() => projectsTable.id, {
      onDelete: "cascade",
    }),
    parentId: integer("parent_id").references((): AnyPgColumn => tasksTable.id, {
      onDelete: "set null",
    }),
    itemType: text("item_type")
      .$type<"epic" | "story" | "task" | "bug" | "test_case">()
      .notNull()
      .default("task"),
    plmUrl: text("plm_url"),
    plmUpdatedAt: timestamp("plm_updated_at", { withTimezone: true }),
    // Raw PLM status string for display fidelity (the mapped `status` drives logic).
    plmStatus: text("plm_status"),
    // Sprint/backlog rank from the tracker, when it returns one (0038). Feeds
    // only the advisory 'out_of_rank' caution; null wherever the tracker gives
    // nothing, and the check skips that finding entirely when rank is absent.
    plmRank: integer("plm_rank"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("tasks_user_id_idx").on(t.userId),
    index("tasks_project_id_idx").on(t.projectId),
    index("tasks_parent_id_idx").on(t.parentId),
  ],
);

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
