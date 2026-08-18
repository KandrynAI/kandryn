import type { ScoreBreakdown } from './scoreBreakdown.js';

/** How a file participates in a suggestion's change set. */
export type SuggestionFileOp = 'create' | 'edit' | 'delete';

/** Lifecycle of applying a single file to the working tree / branch. */
export type SuggestionFileApplyStatus = 'pending' | 'applied' | 'failed';

/** A search/replace hunk for an `edit` operation (Phase 1). */
export interface EditHunk {
  search: string;
  replace: string;
}

/**
 * One file within a suggestion's change set. A suggestion currently always
 * carries exactly one of these (generation emits one file); the array shape lets
 * later phases emit coordinated multi-file diffs without another migration.
 */
export interface SuggestionFile {
  seq: number;
  op: SuggestionFileOp;
  filePath: string;
  /**
   * Resolved content to write: full new content for `create`, and — for `edit` —
   * the result of applying the hunks to the source file at generation time.
   * Empty for `delete`.
   */
  content: string;
  /** The edit's search/replace hunks (Phase 1). Null for create/delete. */
  hunks?: EditHunk[] | null;
  /**
   * Git blob SHA of the source file read when the edit/delete was resolved
   * (Phase 1). Used to detect a branch that changed mid-run. Null for create.
   */
  sourceBlobSha?: string | null;
  /** True when the change set applied cleanly (create/delete always true). */
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
