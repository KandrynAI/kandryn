import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  jsonb,
  numeric,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { runsTable } from "./runs";

// `awaiting_review` (Phase 4, 0029): the confidence gate parked this plan below
// the project threshold — it waits for a human decision before generation, and
// is distinct from `edited` (a human-revised plan).
export type PlanStatus = "planning" | "ready" | "edited" | "failed" | "awaiting_review";
/** How the candidate file set was retrieved. Tree + stack are always included. */
export type RetrievalMode = "graph" | "keyword";

/**
 * One candidate file surfaced by retrieval (Phase 2 PR1). Persisted on the plan
 * even though it is not displayed — when a plan is wrong the first question is
 * whether retrieval surfaced the right files at all. `symbols` are the symbol
 * *names* the graph holds for the file (the graph carries no signatures).
 */
export interface PlanCandidateFile {
  path: string;
  symbols: string[];
  source: "graph" | "keyword";
  // Retrieval relevance score for this candidate (Phase 4, 0029). Graph =
  // queryGraph weighted score; keyword = keyword-match count. Kept so the
  // confidence gate's score-gap signal is auditable. Different scales per
  // source — compare only within a mode. Optional for plans created before 0029.
  score?: number;
}

/**
 * Raw inputs the confidence score (Phase 4, 0029) was computed from, persisted
 * so the score can be audited and recalibrated without re-running planning.
 * Mirrors ConfidenceSignals in the api-server confidence service (lib/db cannot
 * import from artifacts/).
 */
export interface PersistedConfidenceSignals {
  scoreGap: number | null; // (s1 - s2) / s1, within-mode; null if < 2 candidates
  topScore: number | null;
  secondScore: number | null;
  retrievalMode: "graph" | "keyword";
  candidateCount: number;
  countAboveFloor: number;
  floor: number;
  target: number;
  density: number;
  historicalPriorCount: number;
  weights: { gap: number; mode: number; density: number; historical: number };
  perSignal: { gap: number | null; mode: number; density: number; historical: number | null };
  weakestSignal: "gap" | "mode" | "density" | "historical" | null;
}

/**
 * A change plan for a run (Phase 2). The plan belongs to the run, not to a
 * suggestion — both agents implement the same plan and compete on quality.
 * Revisioned rather than mutated: editing a plan supersedes it and inserts
 * revision + 1, so the durable record survives audit retention (reporting).
 */
export const changePlansTable = pgTable(
  "change_plans",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runsTable.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    superseded: boolean("superseded").notNull().default(false),
    status: text("status").$type<PlanStatus>().notNull(),
    model: text("model"),
    // What retrieval returned, for tuning. Not displayed.
    candidateFiles: jsonb("candidate_files").$type<PlanCandidateFile[] | null>(),
    // Planner notes for the generators (e.g. "capped at 10 files"; truncation).
    notes: text("notes"),
    // Retrieval provenance so a bad plan is attributable to a stale index vs the
    // planner itself. graphBuiltAt/graphAgeHours are null when no graph was used.
    retrievalMode: text("retrieval_mode").$type<RetrievalMode>(),
    graphBuiltAt: timestamp("graph_built_at", { withTimezone: true }),
    graphAgeHours: doublePrecision("graph_age_hours"),
    // Confidence gate (Phase 4, 0029). Score 0–1; signals are the raw inputs.
    // Null on plans created before 0029 and on non-ready (planning/failed) rows.
    confidenceScore: numeric("confidence_score"),
    confidenceSignals: jsonb("confidence_signals").$type<PersistedConfidenceSignals | null>(),
    planningMs: integer("planning_ms"),
    retrievalMs: integer("retrieval_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("change_plans_run_revision_idx").on(t.runId, t.revision),
    index("change_plans_run_id_idx").on(t.runId),
  ],
);

export const insertChangePlanSchema = createInsertSchema(changePlansTable).omit({
  id: true,
  createdAt: true,
});
export type InsertChangePlan = z.infer<typeof insertChangePlanSchema>;
export type ChangePlanRow = typeof changePlansTable.$inferSelect;
