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
    // Set true when this row was cloned from a repo shared by multiple projects
    // during the 0020 split — its URL/stack/graph may have been built from another
    // project's codebase and must be confirmed. The UI surfaces a verification
    // banner; confirming (or updating the URL) clears the flag.
    needsVerification: boolean("needs_verification").notNull().default(false),
    stackProfile: jsonb("stack_profile").notNull(),
    // Graphify knowledge graph (0010). All nullable — populated on upload/index.
    graphJson: jsonb("graph_json").$type<PersistedGraphifyGraph | null>().default(null),
    graphBuiltAt: timestamp("graph_built_at", { withTimezone: true }),
    graphNodeCount: integer("graph_node_count"),
    // Rebuild lifecycle (0021): idle → indexing (on trigger) → succeeded|failed
    // (on callback). graphError holds the failure text. Gives the UI a real
    // completion/failure signal instead of a silent "0 nodes" build.
    // `stale` (no migration — text column) is set when the repository URL changes:
    // the existing graph was built against different content, so retrieval must
    // refuse it and fall back to tree-only planning until a rebuild succeeds.
    // `queued` (0048) is what makes indexing survive a serverless response: a
    // trigger that could not reach the microservice parks here and the cron
    // dispatcher drains it, rather than the request being the only chance the
    // index ever gets.
    graphStatus: text("graph_status")
      .$type<"idle" | "queued" | "indexing" | "succeeded" | "failed" | "stale">()
      .notNull()
      .default("idle"),
    graphError: text("graph_error"),
    // When the in-flight index was started, and by whom (0047). graphStartedAt
    // is what makes `indexing` a CLAIM rather than a permanent state: without a
    // timestamp, an index whose callback never arrives leaves the status
    // `indexing` for ever and the duplicate guard then refuses every rebuild,
    // so the repository becomes permanently un-indexable. Reclaimable after
    // INDEX_CLAIM_STALE_MINUTES (services/graphUsability.ts). The same shape
    // ui_style_profiles.claimed_at uses, for the same reason.
    graphStartedAt: timestamp("graph_started_at", { withTimezone: true }),
    graphTriggeredBy: text("graph_triggered_by"),
    // What the customer asked for when they connected this repository, and
    // when it was acted on (0048). Union inlined because lib/db is a composite
    // project rooted at src/ and cannot import from ../../../../shared — see
    // shared/types/repoSetup.ts, which is the source of truth. Nullable: every
    // row written before 0048 predates the question and reads as the default.
    setupChoice: text("setup_choice").$type<"none" | "index" | "index_scan" | "index_scan_review" | null>().default(null),
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    // Why the chosen setup could not be honoured, in words a customer reads
    // (0048): no model key, above the file cap, a scan already running. Null
    // when it worked. Set together with setupCompletedAt, because a refusal is
    // a final answer rather than something to retry every five minutes.
    setupError: text("setup_error"),
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
