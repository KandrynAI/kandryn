export interface ScoreDimension {
  score: number; // 0–100
  weight: number; // percentage weight in overall score
  verdict: 'strong' | 'adequate' | 'weak';
  reason: string; // one sentence explaining this dimension's score
}

export interface ScoreBreakdown {
  correctness: ScoreDimension;
  readability: ScoreDimension;
  minimalDiff: ScoreDimension; // reframed as plan-relative "diff proportionality" (Phase 3)
  conventions: ScoreDimension;
  acCoverage: ScoreDimension; // how well it covers the acceptance criteria
  // Static cross-file coherence (Phase 3), injected mechanically, not model-scored.
  // Optional so runs scored before it existed still parse.
  coherence?: ScoreDimension;
  // Behaviour signals (weight 0 — informational, not part of the overall score).
  // Optional so runs scored before these existed still parse.
  ambiguityHandling?: ScoreDimension; // did it flag ambiguity or silently assume?
  surgicalPrecision?: ScoreDimension; // does every changed line map to a criterion?
  overallNarrative: string; // 2-3 sentence plain-English summary
  recommendation: 'Recommended' | 'Alternative';
  confidence: number; // 0–100, how confident Synthesis is in its ranking
  confidenceReason: string; // one sentence on confidence level
}
