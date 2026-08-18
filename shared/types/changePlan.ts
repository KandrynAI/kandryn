// Change plan (Phase 2). The plan belongs to a run; both agents implement it.
// Mirrors lib/db/src/schema/changePlans.ts (kept separate because lib/db is a
// composite project rooted at src/ and cannot import from ../../../../shared).

export type ChangePlanOp = "create" | "edit" | "delete";
export type PlanStatus = "planning" | "ready" | "edited" | "failed";
export type RetrievalMode = "graph" | "keyword";

/** One planned file. No code — path, operation, intent. */
export interface PlannedFile {
  op: ChangePlanOp;
  path: string;
  /** One line, written for a developer reading the UI: "declare EndorseAsync". */
  rationale: string;
  /** Optional methods/types to add or change, e.g. ["EndorseAsync"]. */
  symbols?: string[];
}

/** The planner's output: paths, operations, intent — no code. */
export interface ChangePlan {
  files: PlannedFile[];
  /** Anything the generators should know (e.g. capped at 10 files). */
  notes?: string;
}

/** One candidate file surfaced by retrieval; persisted for tuning, not shown. */
export interface PlanCandidateFile {
  path: string;
  symbols: string[];
  source: "graph" | "keyword";
}
