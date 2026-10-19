import { pgTable, serial, integer, text, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tasksTable } from "./tasks";

/** One finding from a run-order check. Mirrors shared/types/sequence.ts
 *  (kept local because lib/db is a composite project rooted at src/ and cannot
 *  import from ../../../../shared). */
export interface PersistedSequenceFinding {
  id: string;
  type: string;
  severity: "caution" | "warning";
  summary: string;
  source: "tracker" | "kandryn" | "inferred";
  confidence: "high" | "medium" | "low";
  evidence: {
    itemKeys?: string[];
    runIds?: number[];
    prUrls?: string[];
    files?: string[];
  };
}

/** One grounded fact in the impact bundle, addressable as F1, F2, … */
export interface PersistedSequenceFact {
  id: string;
  text: string;
}

export interface PersistedImpactAnalysis {
  summary: string;
  risks: Array<{
    title: string;
    severity: "low" | "medium" | "high";
    likelihood: "unlikely" | "possible" | "likely";
    explanation: string;
    factRefs: string[];
    mitigation: string;
  }>;
  affectedItems: string[];
  affectedFiles: string[];
  alternative: string;
  source: "ai" | "deterministic";
  model?: string;
}

/**
 * A snapshot of one run-order check as it was shown to a user (0038).
 *
 * Stored rather than recomputed because what the user SAW is what gets audited.
 * `fingerprint` (a hash over the sorted finding ids) lets the run request tell
 * that the world moved between the check and the confirmation without diffing
 * the whole payload — the SEQUENCE_STALE path.
 *
 * `facts` and `impact` contain file PATHS only, never file contents or
 * credential values: both are fed to a model and stored in an audit-adjacent
 * record.
 */
export const sequenceChecksTable = pgTable(
  "sequence_checks",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** Nullable: a personal project has no team. */
    teamId: integer("team_id"),
    workItemId: integer("work_item_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    verdict: text("verdict").$type<"clear" | "caution" | "warning">().notNull(),
    findings: jsonb("findings").$type<PersistedSequenceFinding[]>().notNull().default([]),
    facts: jsonb("facts").$type<PersistedSequenceFact[]>().notNull().default([]),
    policySnapshot: jsonb("policy_snapshot").$type<Record<string, unknown>>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    /** Cached impact; null until the user opens step 2 of the dialog. */
    impact: jsonb("impact").$type<PersistedImpactAnalysis | null>().default(null),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("sequence_checks_item_idx").on(t.workItemId, t.createdAt),
    index("sequence_checks_user_idx").on(t.userId, t.createdAt),
    check("sequence_checks_verdict_check", sql`${t.verdict} IN ('clear','caution','warning')`),
  ],
);

export type SequenceCheckRow = typeof sequenceChecksTable.$inferSelect;
