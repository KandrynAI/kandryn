import type { ScoreBreakdown } from './scoreBreakdown.js';

export interface CodeSuggestion {
  agent: 'claude' | 'openai' | 'copilot' | 'antigravity';
  code: string;
  explanation: string;
  filePath: string;
  language: string;
  score?: number;
  recommendation?: string;
  scoreBreakdown?: ScoreBreakdown | null;
  scoreNarrative?: string | null;
}
