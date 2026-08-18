import type { ScoreBreakdown } from './scoreBreakdown.js';

/** How a file participates in a suggestion's change set. */
export type SuggestionFileOp = 'create' | 'edit' | 'delete';

/** Lifecycle of applying a single file to the working tree / branch. */
export type SuggestionFileApplyStatus = 'pending' | 'applied' | 'failed';

/**
 * One file within a suggestion's change set (Phase 0 multi-file scaffolding).
 * A suggestion currently always carries exactly one of these; the array shape
 * exists so later phases can emit coordinated multi-file diffs without another
 * schema/type migration.
 */
export interface SuggestionFile {
  seq: number;
  op: SuggestionFileOp;
  filePath: string;
  /** Full new file content for create/edit; empty for delete. */
  content: string;
  /** Structured diff hunks — null until a later phase populates them. */
  hunks?: unknown | null;
  /** Whether any merge/apply ambiguity for this file has been resolved. */
  resolved: boolean;
  applyStatus: SuggestionFileApplyStatus;
  applyError?: string | null;
  linesAdded: number;
  linesRemoved: number;
}

export interface SuggestionStats {
  filesChanged: number;
  added: number;
  removed: number;
}

export interface CodeSuggestion {
  agent: 'claude' | 'openai' | 'copilot' | 'antigravity';
  /** The suggestion's change set. Phase 0: always exactly one file. */
  files: SuggestionFile[];
  /** False when the model output could not be turned into a usable change set. */
  valid: boolean;
  stats: SuggestionStats;
  explanation: string;
  language: string;
  score?: number;
  recommendation?: string;
  scoreBreakdown?: ScoreBreakdown | null;
  scoreNarrative?: string | null;
}
