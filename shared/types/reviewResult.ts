export interface ReviewFinding {
  type:      'strength' | 'gap' | 'risk'
  title:     string           // max 6 words
  detail:    string           // 1-2 sentences, specific
  acRef?:    string           // which AC item this relates to (optional)
  severity?: 'low' | 'medium' | 'high'  // gaps and risks only
  filePath?: string           // the changed file this finding concerns, when file-specific
                              // (validated against the change set; a coherence
                              // finding spanning files omits it)
}

export interface ReviewResult {
  summary:     string          // 2-3 sentence overall assessment
  acCoverage: {
    covered:   string[]        // AC items fully addressed
    missed:    string[]        // AC items not addressed at all
    partial:   string[]        // AC items partially addressed
  }
  findings:    ReviewFinding[] // strengths, gaps, risks
  reviewerNote: string         // one sentence: what to focus on in review
  generatedAt:  string         // ISO timestamp
}
