export interface ScoreDimension {
  score: number; // 0–100
  weight: number; // percentage weight in overall score
  verdict: 'strong' | 'adequate' | 'weak';
  reason: string; // one sentence explaining this dimension's score
}

export interface ScoreBreakdown {
  correctness: ScoreDimension;
  readability: ScoreDimension;
  minimalDiff: ScoreDimension;
  conventions: ScoreDimension;
  acCoverage: ScoreDimension; // how well it covers the acceptance criteria
  overallNarrative: string; // 2-3 sentence plain-English summary
  recommendation: 'Recommended' | 'Alternative';
  confidence: number; // 0–100, how confident Synthesis is in its ranking
  confidenceReason: string; // one sentence on confidence level
}
