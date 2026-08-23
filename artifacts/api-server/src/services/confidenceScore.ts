import type { PersistedConfidenceSignals } from "@workspace/db";

// Pure confidence scoring — no db, so it is unit-testable without a DATABASE_URL.
// A weighted average over the AVAILABLE signals with RENORMALISATION: a signal
// that can't be computed for this plan (no second candidate to form a gap; no
// historical priors yet) is dropped from numerator and denominator, so it reads
// as neutral rather than a zero penalty. Weights/floors are UNCALIBRATED
// placeholders; the raw inputs are persisted so they can be recalibrated later.

export const WEIGHTS = { gap: 0.4, mode: 0.2, density: 0.2, historical: 0.2 } as const;
export const DENSITY_TARGET = 5; // candidates above the floor for full density credit
export const KEYWORD_FLOOR = 2; // keyword score = keyword-match count → ≥2 keywords hit
export const GRAPH_FLOOR = 5; // graph queryGraph score → at least a label-substring hit

export type ConfidenceSignals = PersistedConfidenceSignals;

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export const modeWeight = (mode: "graph" | "keyword"): number => (mode === "graph" ? 1.0 : 0.5);

/**
 * The scoring core: given the per-signal inputs, produce the 0–1 score, the
 * normalised per-signal values, and the weakest present signal (drives the
 * awaiting-review reason line). Deterministic.
 */
export function confidenceFromSignals(input: {
  scoreGap: number | null;
  retrievalMode: "graph" | "keyword";
  density: number;
  historicalPriorCount: number;
}): {
  score: number;
  perSignal: PersistedConfidenceSignals["perSignal"];
  weakestSignal: PersistedConfidenceSignals["weakestSignal"];
} {
  const perSignal = {
    gap: input.scoreGap != null ? clamp01(input.scoreGap) : null,
    mode: modeWeight(input.retrievalMode),
    density: clamp01(input.density),
    historical: input.historicalPriorCount > 0 ? 1 : null, // neutral when no priors
  };

  const present: Array<{ name: NonNullable<PersistedConfidenceSignals["weakestSignal"]>; weight: number; value: number }> = [];
  if (perSignal.gap != null) present.push({ name: "gap", weight: WEIGHTS.gap, value: perSignal.gap });
  present.push({ name: "mode", weight: WEIGHTS.mode, value: perSignal.mode });
  present.push({ name: "density", weight: WEIGHTS.density, value: perSignal.density });
  if (perSignal.historical != null) present.push({ name: "historical", weight: WEIGHTS.historical, value: perSignal.historical });

  let num = 0;
  let den = 0;
  for (const p of present) {
    num += p.weight * p.value;
    den += p.weight;
  }
  const score = den > 0 ? num / den : 0.5;

  let weakestSignal: PersistedConfidenceSignals["weakestSignal"] = null;
  let min = Infinity;
  for (const p of present) {
    if (p.value < min) {
      min = p.value;
      weakestSignal = p.name;
    }
  }
  return { score, perSignal, weakestSignal };
}

/** A specific one-line reason for the awaiting-review banner, derived from the
 *  weakest present signal — never a hard-coded generic message. */
export function confidenceReason(signals: ConfidenceSignals): string {
  switch (signals.weakestSignal) {
    case "gap":
      return signals.topScore != null && signals.secondScore != null
        ? `Several files scored almost equally (top ${signals.topScore} vs ${signals.secondScore}) — no clear best candidate.`
        : "Several files scored almost equally — no clear best candidate.";
    case "density":
      return `Only ${signals.countAboveFloor} file(s) cleared the relevance bar for this change — retrieval may have missed the right files.`;
    case "mode":
      return "Context came from keyword search rather than the code graph, so candidate quality is lower.";
    case "historical":
      return "This exact change has not been accepted before in this project.";
    default:
      return "Low confidence in the retrieved file set for this change.";
  }
}
