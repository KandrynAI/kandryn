import { pgTable, serial, text, timestamp, jsonb, integer, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Graphify knowledge graph, persisted per repository (0010_graphify_graph.sql).
 * Mirrors shared/types/graphifyGraph.ts (kept local because lib/db is a
 * composite project rooted at src/ and cannot import from ../../../../shared).
 */
export interface PersistedGraphifyGraph {
  nodes: Array<{
    id: string;
    label: string;
    fileType?: string;
    sourceFile?: string;
    sourceLocation?: string;
    community?: number;
    degree?: number;
  }>;
  edges: Array<{ source: string; target: string; relation: string; confidence: string }>;
  metadata: { files: number; nodes: number; edges: number; builtAt?: string; repoUrl?: string };
}

export const repositoriesTable = pgTable(
  "repositories",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    // Nullable so a repository flagged as needing reconfiguration (its URL failed
    // validation, e.g. owner === repo) can have its URL cleared without deleting
    // the record (0019).
    url: text("url"),
    defaultBranch: text("default_branch").notNull().default("main"),
    // Owning project (0019). Plain int, no Drizzle .references() to avoid a schema
    // import cycle (projects already imports repositories); the FK lives in the SQL
    // migration. Populated when a project binds this repo.
    projectId: integer("project_id"),
    // Set true when the stored URL failed validation and was cleared (0019). The UI
    // surfaces a reconfiguration banner; a successful URL update clears the flag.
    needsReconfiguration: boolean("needs_reconfiguration").notNull().default(false),
    stackProfile: jsonb("stack_profile").notNull(),
    // Graphify knowledge graph (0010). All nullable — populated on upload/index.
    graphJson: jsonb("graph_json").$type<PersistedGraphifyGraph | null>().default(null),
    graphBuiltAt: timestamp("graph_built_at", { withTimezone: true }),
    graphNodeCount: integer("graph_node_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repositories_user_id_idx").on(t.userId)],
);

export const insertRepositorySchema = createInsertSchema(repositoriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRepository = z.infer<typeof insertRepositorySchema>;
export type Repository = typeof repositoriesTable.$inferSelect;
