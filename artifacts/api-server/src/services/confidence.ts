import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { PlanCandidateFile } from "@workspace/db";
import {
  confidenceFromSignals,
  DENSITY_TARGET,
  GRAPH_FLOOR,
  KEYWORD_FLOOR,
  WEIGHTS,
  clamp01,
  type ConfidenceSignals,
} from "./confidenceScore.js";

// Re-export the pure scoring surface so callers have one import site.
export { confidenceFromSignals, confidenceReason, WEIGHTS, type ConfidenceSignals } from "./confidenceScore.js";

/**
 * Historical acceptance (v1, exact file-set match): how many PRIOR plans in this
 * project had the identical file set AND their run committed a suggestion
 * without the plan being revised. Best-effort — never fails the gate; a query
 * error or no priors both yield 0 (which the scorer treats as neutral).
 */
export async function gatherPriorAcceptedCount(projectId: number, filePaths: string[]): Promise<number> {
  const signature = [...new Set(filePaths)].sort().join(",");
  if (!signature) return 0;
  try {
    const res = await db.execute(sql`
      WITH sig AS (
        SELECT plan_id, string_agg(DISTINCT file_path, ',' ORDER BY file_path) AS fileset
        FROM change_plan_files
        GROUP BY plan_id
      )
      SELECT count(*)::int AS n
      FROM sig s
      JOIN change_plans cp ON cp.id = s.plan_id AND cp.revision = 1 AND cp.superseded = false
      JOIN runs r ON r.id = cp.run_id
      WHERE r.project_id = ${projectId}
        AND r.committed_suggestion_id IS NOT NULL
        AND s.fileset = ${signature}
    `);
    const rows = (res as unknown as { rows?: Array<{ n: number }> }).rows ?? [];
    const n = Number(rows[0]?.n ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Compute a plan's confidence from its retrieval candidates (carrying per-file
 * scores), retrieval mode, and file set. Returns the 0–1 score plus the full raw
 * signals to persist for audit/recalibration.
 */
export async function computePlanConfidence(input: {
  candidates: PlanCandidateFile[];
  retrievalMode: "graph" | "keyword";
  planFilePaths: string[];
  projectId: number;
}): Promise<{ score: number; signals: ConfidenceSignals }> {
  const { candidates, retrievalMode, planFilePaths, projectId } = input;
  const floor = retrievalMode === "graph" ? GRAPH_FLOOR : KEYWORD_FLOOR;

  const scores = candidates.map((c) => c.score ?? 0).sort((a, b) => b - a);
  const topScore = scores.length > 0 ? scores[0] : null;
  const secondScore = scores.length > 1 ? scores[1] : null;
  const scoreGap =
    topScore != null && secondScore != null && topScore > 0 ? clamp01((topScore - secondScore) / topScore) : null;

  const countAboveFloor = candidates.filter((c) => (c.score ?? 0) >= floor).length;
  const density = Math.min(countAboveFloor / DENSITY_TARGET, 1);
  const historicalPriorCount = await gatherPriorAcceptedCount(projectId, planFilePaths);

  const { score, perSignal, weakestSignal } = confidenceFromSignals({ scoreGap, retrievalMode, density, historicalPriorCount });

  return {
    score,
    signals: {
      scoreGap,
      topScore,
      secondScore,
      retrievalMode,
      candidateCount: candidates.length,
      countAboveFloor,
      floor,
      target: DENSITY_TARGET,
      density,
      historicalPriorCount,
      weights: { ...WEIGHTS },
      perSignal,
      weakestSignal,
    },
  };
}
