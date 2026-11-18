import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  numeric,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Domain context: extracted meaning, with evidence and a review gate (0052).
 *
 * Three tables, and the shape follows from one fact: an extracted rule is a
 * model's inference, and a wrong one injected into every prompt is worse than
 * no context at all because it is confident and invisible. So every statement
 * carries evidence, nothing is authoritative until a human confirms it, and
 * the database enforces both rather than trusting the service to.
 *
 * SCOPE: project, with repository-scoped evidence. A rule is a statement about
 * the project's domain; its evidence cites a file in whichever repository was
 * bound when it was read. Repositories get re-pointed to new URLs, and a
 * repository-scoped rule would be destroyed by that, while a project-scoped
 * rule merely loses its evidence and becomes `needs_review`. Rules read from
 * the tracker have no repository to belong to at all.
 *
 * Unions are inlined rather than imported: lib/db is a composite project
 * rooted at src/ and cannot reach ../../../../shared.
 * shared/types/domainRule.ts is the source of truth.
 *
 * Phase 3 draws a TREE over these rows. It is deliberately not built here:
 * tree tables created before anything fills them would be shaped by guesswork.
 * The edges it needs are an additive table, not a rewrite of these.
 */

/** One run of the extractor over a project. */
export const domainExtractionsTable = pgTable(
  "domain_extractions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: integer("project_id").notNull(),
    /** The repository the code evidence was read from, if any was. */
    repositoryId: integer("repository_id"),
    teamId: integer("team_id"),
    triggeredBy: text("triggered_by").notNull(),

    status: text("status")
      .$type<"queued" | "extracting" | "succeeded" | "failed">()
      .notNull()
      .default("queued"),

    /**
     * The commit the code evidence was read at. Without it, a rule citing
     * `src/billing.ts:40` cannot be checked against anything later: the line
     * has moved and there is no record of what it said when it was read.
     */
    sourceRef: text("source_ref"),

    /**
     * How many of each source kind were read (tracker items, code files, graph
     * nodes, documents). Counts and nothing else, the rule
     * `runs.context_manifest` follows: never the text that was read.
     */
    sourcesCounted: jsonb("sources_counted").$type<Record<string, number> | null>().default(null),
    rulesProposed: integer("rules_proposed").notNull().default(0),

    batchId: text("batch_id"),
    model: text("model"),

    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 4 }),
    actualCostUsd: numeric("actual_cost_usd", { precision: 10, scale: 4 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("domain_extractions_project_idx").on(t.projectId),
    index("domain_extractions_status_idx").on(t.status),
    check(
      "domain_extractions_status_valid",
      sql`${t.status} IN ('queued', 'extracting', 'succeeded', 'failed')`,
    ),
  ],
);

/**
 * One statement about the project's domain.
 *
 * The two CHECK constraints are the review gate made structural, and they are
 * the point of this table. A service can be edited; a constraint cannot be
 * forgotten.
 */
export const domainRulesTable = pgTable(
  "domain_rules",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    projectId: integer("project_id").notNull(),

    /**
     * The extraction that proposed this. ON DELETE SET NULL, not CASCADE: a
     * confirmed rule is a human decision and must outlive the job that
     * suggested it, exactly as sequence_overrides outlives its run.
     */
    extractionId: integer("extraction_id").references(
      (): AnyPgColumn => domainExtractionsTable.id,
      { onDelete: "set null" },
    ),

    kind: text("kind").$type<"rule" | "term" | "entity" | "workflow">().notNull(),
    /** The statement itself, in the customer's own business language. */
    statement: text("statement").notNull(),
    detail: text("detail"),

    status: text("status")
      .$type<"proposed" | "confirmed" | "rejected" | "needs_review">()
      .notNull()
      .default("proposed"),
    /** The extractor's own confidence, 0 to 1. Advisory, never a gate. */
    confidence: numeric("confidence"),
    origin: text("origin").$type<"inferred" | "human">().notNull().default("inferred"),

    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),

    /**
     * Set when a human edit replaces this row. An edit writes a NEW row and
     * supersedes the old one rather than mutating it, so the history of what
     * was confirmed and when survives. The precedent is change_plans.
     */
    supersededBy: integer("superseded_by").references((): AnyPgColumn => domainRulesTable.id, {
      onDelete: "set null",
    }),
    revision: integer("revision").notNull().default(1),

    /**
     * hash(project, kind, normalised statement). Carries a human decision
     * forward across re-extractions, the pattern that already works for
     * baseline and review findings: a rule someone rejected must not come back
     * as new because the model reworded it.
     */
    fingerprint: text("fingerprint").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("domain_rules_project_idx").on(t.projectId),
    index("domain_rules_status_idx").on(t.status),
    index("domain_rules_fingerprint_idx").on(t.fingerprint),
    check("domain_rules_kind_valid", sql`${t.kind} IN ('rule', 'term', 'entity', 'workflow')`),
    check(
      "domain_rules_status_valid",
      sql`${t.status} IN ('proposed', 'confirmed', 'rejected', 'needs_review')`,
    ),
    check("domain_rules_origin_valid", sql`${t.origin} IN ('inferred', 'human')`),
    /**
     * A confirmed rule names its reviewer. This is the review gate itself: a
     * row reaching a prompt because it says `confirmed` must be traceable to
     * the person who made it authoritative, and an extractor cannot write one
     * because it has no reviewer to name.
     */
    check(
      "domain_rules_confirmed_has_reviewer",
      sql`${t.status} <> 'confirmed' OR ${t.reviewedBy} IS NOT NULL`,
    ),
    /**
     * A rejected rule says why. The same discipline baseline_findings carries:
     * a rejection with no stated reason is indistinguishable from one nobody
     * looked at, and it is carried forward silently into every later
     * extraction.
     */
    check(
      "domain_rules_rejected_has_reason",
      sql`${t.status} <> 'rejected' OR btrim(coalesce(${t.reviewNote}, '')) <> ''`,
    ),
  ],
);

/**
 * Where one statement's evidence points.
 *
 * ITS OWN TABLE rather than a jsonb array on the rule, for two reasons. The
 * question Phase 4 has to answer is "which rules cite this file", so a commit
 * can mark them `needs_review`; that is an indexed join here and a GIN
 * containment query there, and CLAUDE.md already records that `drizzle-kit
 * push` silently drops a GIN index it cannot see in the Drizzle schema. And
 * "every rule carries evidence" is checkable as a row count, not as the shape
 * of a blob.
 *
 * THERE IS NO `quote` COLUMN, deliberately. Evidence is identifiers only:
 * a path and a line, a tracker key, a document id. A quote would make this the
 * first table that stores excerpts of a customer's code and documents, and the
 * first endpoint that returns them to anyone who can read a project. The same
 * rule 0042's exemplars follow (`{path, sha}`) and 0044's events follow.
 */
export const domainRuleEvidenceTable = pgTable(
  "domain_rule_evidence",
  {
    id: serial("id").primaryKey(),
    ruleId: integer("rule_id")
      .notNull()
      .references((): AnyPgColumn => domainRulesTable.id, { onDelete: "cascade" }),

    kind: text("kind").$type<"code" | "tracker" | "document" | "person">().notNull(),

    /** code: which repository, which file, which lines, at which commit. */
    repositoryId: integer("repository_id"),
    filePath: text("file_path"),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    sourceRef: text("source_ref"),

    /** tracker: the work item key, e.g. PAY-14. */
    plmKey: text("plm_key"),

    /** document: the uploaded source it came from (0041). */
    knowledgeSourceId: integer("knowledge_source_id"),

    /** person: who stated it. A rule from a conversation is a real source. */
    statedBy: text("stated_by"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("domain_rule_evidence_rule_idx").on(t.ruleId),
    // The Phase 4 question, indexed now because it is why this is a table:
    // "which rules cite a file that just changed".
    index("domain_rule_evidence_file_idx").on(t.repositoryId, t.filePath),
    check(
      "domain_rule_evidence_kind_valid",
      sql`${t.kind} IN ('code', 'tracker', 'document', 'person')`,
    ),
    /**
     * Each kind carries the locator that makes it checkable. Code evidence
     * without a path cannot be verified against anything, and tracker evidence
     * without a key cannot be followed, so neither is evidence.
     */
    check(
      "domain_rule_evidence_has_locator",
      sql`(${t.kind} = 'code' AND ${t.filePath} IS NOT NULL)
        OR (${t.kind} = 'tracker' AND ${t.plmKey} IS NOT NULL)
        OR (${t.kind} = 'document' AND ${t.knowledgeSourceId} IS NOT NULL)
        OR (${t.kind} = 'person' AND ${t.statedBy} IS NOT NULL)`,
    ),
  ],
);

export type DomainExtraction = typeof domainExtractionsTable.$inferSelect;
export type DomainRule = typeof domainRulesTable.$inferSelect;
export type DomainRuleEvidence = typeof domainRuleEvidenceTable.$inferSelect;
