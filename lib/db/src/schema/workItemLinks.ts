import { pgTable, serial, integer, text, numeric, timestamp, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tasksTable } from "./tasks";
import { projectsTable } from "./projects";

/**
 * A dependency edge between two work items (0038).
 *
 * `blocks` is the only type that produces a blocking finding: from_item must
 * finish before to_item can safely run, because generation reads the default
 * branch and an unlanded prerequisite simply is not there. `parent` mirrors the
 * hierarchy already on tasks.parent_id, kept here so the graph code has one
 * edge list to walk. `relates` is informational and never produces a finding.
 *
 * `source` drives reconciliation: tracker edges are re-derived from Jira/ADO on
 * every sync and stale ones deleted, while `manual` and `inferred` rows are
 * never touched by sync. It is part of the unique key so the same edge can
 * exist from two origins — a human confirming what the model guessed — without
 * one silently overwriting the other.
 *
 * A dismissed row is kept rather than deleted: "a human said this is not a
 * dependency" is worth retaining, and the next sync must not resurrect it.
 */
export const workItemLinksTable = pgTable(
  "work_item_links",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    // Nullable: a personal project has no team. Denormalised for reporting;
    // access is decided by userId (+ canAdminister), never by this column.
    teamId: integer("team_id"),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    fromItemId: integer("from_item_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    toItemId: integer("to_item_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    linkType: text("link_type").$type<"blocks" | "parent" | "relates">().notNull(),
    source: text("source").$type<"tracker" | "inferred" | "manual">().notNull(),
    /** Only meaningful for source 'inferred'; null for tracker and manual. */
    confidence: numeric("confidence"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedBy: text("dismissed_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Project-leading, not team-leading: team_id is null for every personal
    // project and would be dead weight at the front of the key.
    index("work_item_links_to_idx").on(t.projectId, t.toItemId),
    index("work_item_links_from_idx").on(t.projectId, t.fromItemId),
    index("work_item_links_user_idx").on(t.userId),
    unique("work_item_links_edge_uq").on(t.fromItemId, t.toItemId, t.linkType, t.source),
    // Declared here as well as in 0038 so `drizzle-kit push` cannot create this
    // table without them on a database that has not run the migration by hand.
    // Names match the ones Postgres assigned in 0038, so push sees no drift.
    check("work_item_links_no_self", sql`${t.fromItemId} <> ${t.toItemId}`),
    check("work_item_links_link_type_check", sql`${t.linkType} IN ('blocks','parent','relates')`),
    check("work_item_links_source_check", sql`${t.source} IN ('tracker','inferred','manual')`),
  ],
);

export type WorkItemLink = typeof workItemLinksTable.$inferSelect;
