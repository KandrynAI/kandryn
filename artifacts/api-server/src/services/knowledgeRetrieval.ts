import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";

/**
 * Find the passages of a project's documents that bear on one work item (0041).
 *
 * Postgres full-text search, not embeddings: `websearch_to_tsquery` plus
 * `ts_rank_cd` over the stored `tsv` column and its GIN index. That keeps
 * retrieval inside the database the data already lives in — no vector store,
 * no second service, no embedding key, and no extension on the pooler.
 *
 * The rank bar matters more than the limit. An architecture document will
 * always return *something* for any query; injecting six weakly-matching
 * passages is worse than injecting none, because the model treats whatever it
 * is given as relevant. Below the bar the pack simply carries no reference
 * material.
 */

/**
 * Floor for ts_rank_cd, measured rather than guessed. On a seeded fixture an
 * on-topic passage scored 1.1 while a passage containing exactly one of the
 * query terms in incidental prose scored 0.1, so the bar sits between them:
 * one stray word is not relevance, two related terms in proximity is.
 *
 * It is calibrated against synthetic documents and will want revisiting
 * against real ones — the same caveat the confidence threshold carries.
 */
const MIN_RANK = 0.25;

export interface RetrievedReference {
  sourceId: number;
  chunkId: number;
  title: string;
  docType: string;
  heading: string | null;
  page: number | null;
  text: string;
  rank: number;
}

/** websearch_to_tsquery reads these as operators, so they never travel as terms. */
const OPERATOR_WORDS = new Set(["or", "and", "not"]);

/**
 * Build the search query from the work item: its title, then the opening words
 * of each acceptance criterion — the AC is where the domain nouns are, but a
 * whole criterion is a sentence, and a sentence makes a diffuse query.
 *
 * The terms are joined with `or`, deliberately. websearch_to_tsquery ANDs
 * adjacent words, and an AND over a title plus acceptance criteria matches
 * essentially nothing: no single passage of a document contains every word of
 * a work item. OR semantics plus the rank bar is the combination that works —
 * ts_rank_cd does the discriminating, and MIN_RANK decides what counts.
 *
 * No stopword list: `websearch_to_tsquery('english', …)` already drops them.
 */
export function buildSearchQuery(workItem: { title: string; acceptanceCriteria?: string[] }): string {
  const acWords = (workItem.acceptanceCriteria ?? [])
    .map((c) => c.split(/\s+/).slice(0, 8).join(" "))
    .join(" ");
  const terms = `${workItem.title} ${acWords}`
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !OPERATOR_WORDS.has(w));
  return [...new Set(terms)].slice(0, 20).join(" or ");
}

/**
 * The top-ranked passages for this work item, or [] — including on failure.
 * Retrieval is an improvement to a run, never a precondition for one, so every
 * error path here returns [] and logs without the query or the document text.
 */
export async function retrieveReferences(input: {
  userId: string;
  projectId: number;
  workItem: { title: string; acceptanceCriteria?: string[] };
  limit?: number;
}): Promise<RetrievedReference[]> {
  const limit = input.limit ?? 6;
  const query = buildSearchQuery(input.workItem);
  if (!query) return [];

  try {
    // Raw SQL because the tsquery functions and ts_rank_cd have no Drizzle
    // builder equivalent. Every value is parameterised; both scoping columns
    // are in the WHERE clause, and only chunks of a 'ready' source are
    // eligible — a half-indexed document must not reach a prompt.
    const rows = await db.execute<{
      source_id: number;
      chunk_id: number;
      title: string;
      doc_type: string;
      heading: string | null;
      page: number | null;
      text: string;
      rank: number;
    }>(sql`
      SELECT c.source_id,
             c.id          AS chunk_id,
             s.title,
             s.doc_type,
             c.heading,
             c.page,
             c.text,
             ts_rank_cd(c.tsv, q) AS rank
        FROM knowledge_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id
        CROSS JOIN websearch_to_tsquery('english', ${query}) q
       WHERE c.user_id = ${input.userId}
         AND c.project_id = ${input.projectId}
         AND s.status = 'ready'
         AND c.tsv @@ q
         AND ts_rank_cd(c.tsv, q) >= ${MIN_RANK}
       ORDER BY rank DESC, c.id ASC
       LIMIT ${limit}
    `);

    const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? []) as Array<{
      source_id: number;
      chunk_id: number;
      title: string;
      doc_type: string;
      heading: string | null;
      page: number | null;
      text: string;
      rank: number | string;
    }>;

    return list.map((r) => ({
      sourceId: Number(r.source_id),
      chunkId: Number(r.chunk_id),
      title: r.title,
      docType: r.doc_type,
      heading: r.heading,
      page: r.page == null ? null : Number(r.page),
      text: r.text,
      rank: Number(r.rank),
    }));
  } catch (err) {
    // No query text and no document text in the log.
    logger.warn({ err, projectId: input.projectId }, "Knowledge retrieval failed; running without reference material");
    return [];
  }
}

export { MIN_RANK };
