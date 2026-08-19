// Static coherence check (Phase 3) — a mechanical, pre-commit cross-file check
// that feeds Synthesia's ranking. Persisted on the suggestion and shown in the
// diff viewer. C# only for v1.

export type CoherenceCheck = 'interface_impl' | 'type_resolution' | 'caller_callee' | 'imports';
export type CoherenceSeverity = 'error' | 'warning';
export type CoherenceStatus = 'passed' | 'warnings' | 'failed';

export interface CoherenceFinding {
  check: CoherenceCheck;
  severity: CoherenceSeverity;
  /** The changed file the finding is in (authoritative — computed, not model-tagged). */
  filePath: string;
  line?: number;
  message: string;
  /** The other file involved, e.g. the interface a call disagrees with. */
  relatedFilePath?: string;
}

/**
 * Something the checker declined to evaluate — a regex-checker blind spot
 * (multi-line signature, primary constructor, generic method, unresolved
 * receiver, …). Captured, not surfaced in the UI yet. Like Phase 2's
 * `in_candidates`: cheap to record now, valuable once real customer repos hit
 * idioms the pattern checker was not built for.
 */
export interface CoherenceSkip {
  filePath: string;
  line?: number;
  reason: string;
  detail?: string;
}

export interface CoherenceResult {
  findings: CoherenceFinding[];
  /** What the checker could not evaluate, and why. */
  skipped: CoherenceSkip[];
  /** 1.0, minus 0.25 per error and 0.1 per warning, floored at 0. */
  score: number;
  /** Derived: failed if any error, warnings if any warning (no error), else passed. */
  status: CoherenceStatus;
}
