import { pgTable, serial, integer, text, timestamp, index, unique, uniqueIndex, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type KnowledgeDocType = "architecture" | "requirements" | "design" | "other";
export type KnowledgeSourceStatus = "pending" | "parsing" | "ready" | "failed";

/**
 * An uploaded project document (0041). The row is the document's identity and
 * state; its TEXT is never stored here — only in `knowledge_chunks`.
 *
 * `project_id` is a plain int (FK declared in SQL only), matching the
 * precedent set by runs.repository_id: the binding is enforced in the
 * database without creating a schema import cycle here.
 */
export const knowledgeSourcesTable = pgTable(
  "knowledge_sources",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: integer("project_id").notNull(),
    docType: text("doc_type").$type<KnowledgeDocType>().notNull(),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Server-generated object path. The client never chooses it. */
    storagePath: text("storage_path").notNull(),
    /** sha256 of the real bytes, set at completion. Null while pending. */
    contentHash: text("content_hash"),
    status: text("status").$type<KnowledgeSourceStatus>().notNull().default("pending"),
    /** Short, safe failure reason. Never a fragment of the document. */
    error: text("error"),
    chunkCount: integer("chunk_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
  },
  (t) => [
    index("knowledge_sources_project_idx").on(t.userId, t.projectId),
    // Declared here, not only in SQL: drizzle-kit push drops an index it
    // cannot see in the schema, so leaving this partial unique index to the
    // migration alone means the next `db:migrate` silently removes the
    // duplicate-upload guard. Verified against push.
    uniqueIndex("knowledge_sources_hash_uq")
      .on(t.projectId, t.contentHash)
      .where(sql`content_hash IS NOT NULL`),
  ],
);

/**
 * Postgres `tsvector`, declared so drizzle-kit push sees the generated column
 * that the migration creates and leaves it alone. Without this the column
 * exists in the database and not in the schema, and push proposes dropping it
 * — taking the GIN index and the whole search path with it.
 */
const tsvector = customType<{ data: string; driverData: string; notNull: true }>({
  dataType: () => "tsvector",
});

/**
 * A retrievable passage of a document (0041). The only place document text
 * lives.
 *
 * `user_id` and `project_id` are denormalised from the source so retrieval can
 * filter on both without a join — the scoping rule holds in the query that
 * actually reaches a prompt, not one table away.
 */
export const knowledgeChunksTable = pgTable(
  "knowledge_chunks",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    projectId: integer("project_id").notNull(),
    seq: integer("seq").notNull(),
    /** Heading path for md/docx ("Architecture > Billing"), null otherwise. */
    heading: text("heading"),
    /** 1-based page for pdf chunks, null otherwise. */
    page: integer("page"),
    text: text("text").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(heading, '') || ' ' || text)`,
    ),
  },
  (t) => [
    index("knowledge_chunks_project_idx").on(t.userId, t.projectId),
    // Same reason as the partial unique index above — an undeclared GIN index
    // is an index push deletes, and losing it takes the whole search path
    // down to a sequential scan without any error.
    index("knowledge_chunks_tsv_idx").using("gin", t.tsv),
    unique("knowledge_chunks_source_seq_uq").on(t.sourceId, t.seq),
  ],
);

export const insertKnowledgeSourceSchema = createInsertSchema(knowledgeSourcesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertKnowledgeSource = z.infer<typeof insertKnowledgeSourceSchema>;
export type KnowledgeSource = typeof knowledgeSourcesTable.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunksTable.$inferSelect;
