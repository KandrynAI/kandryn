/**
 * Sequence Guard — run-order checking, override, and the decision record.
 *
 * A run is generated against the repository's DEFAULT BRANCH. If a prerequisite
 * work item has not landed there, the run cannot see its changes: the result is
 * duplicated work, a merge conflict, or code that assumes something that does
 * not exist yet. These types describe what the server found, what it predicts
 * will happen, and what the user decided.
 */

export type SequenceVerdict = "clear" | "caution" | "warning";
export type FindingSeverity = "caution" | "warning";

export type FindingType =
  /** The tracker says A blocks B, and A is not done. */
  | "unmet_blocker"
  /** A has a Kandryn PR that is open, not merged. */
  | "blocker_pr_unmerged"
  /** A's Aegis security gate is blocked. */
  | "blocker_gate_blocked"
  /** Running a parent while its child items are still open. */
  | "children_incomplete"
  /** An open Kandryn PR or a pending run already touches the same files. */
  | "file_overlap"
  /** A blocks B blocks A. */
  | "dependency_cycle"
  /** Model-inferred, advisory only — never raises above `caution`. */
  | "inferred_prerequisite"
  /** A much higher-ranked item in the same epic or sprint is still open. */
  | "out_of_rank";

export interface SequenceFinding {
  /** Stable: sha256 of type + sorted evidence ids, first 12 hex. */
  id: string;
  type: FindingType;
  severity: FindingSeverity;
  /** One plain sentence, stating the consequence rather than the rule. */
  summary: string;
  source: "tracker" | "kandryn" | "inferred";
  confidence: "high" | "medium" | "low";
  evidence: {
    itemKeys?: string[];
    runIds?: number[];
    prUrls?: string[];
    files?: string[];
  };
}

export interface SequenceCheck {
  checkId: number;
  workItemId: number;
  /** The tracker key, e.g. "PAY-214" — what the dialog and the record name. */
  itemKey: string;
  itemTitle: string;
  verdict: SequenceVerdict;
  findings: SequenceFinding[];
  suggestedFirst: { itemKey: string; itemId: number; reason: string }[];
  policy: SequencePolicy;
  /** False for a member under `admin_override_only`. */
  canOverride: boolean;
  expiresAt: string;
}

export interface ImpactRisk {
  title: string;
  severity: "low" | "medium" | "high";
  likelihood: "unlikely" | "possible" | "likely";
  explanation: string;
  /** Ids from the fact bundle, e.g. ['F1','F3']. Every risk must cite at least
   *  one, and a risk citing a fact not in the bundle is dropped. */
  factRefs: string[];
  mitigation: string;
}

export interface ImpactAnalysis {
  summary: string;
  risks: ImpactRisk[];
  /** Item keys downstream of this one. */
  affectedItems: string[];
  affectedFiles: string[];
  /** What to do instead, one or two sentences. */
  alternative: string;
  source: "ai" | "deterministic";
  model?: string;
}

/** One grounded fact the impact narrative may cite. Paths only — never file
 *  contents, never credential values. */
export interface SequenceFact {
  id: string;
  text: string;
  /**
   * True when the text came from a tracker field a user wrote — a title,
   * description or acceptance criterion. Rendered inside delimiters and
   * declared as data in any model prompt, because it can contain anything,
   * including something shaped like an instruction.
   */
  untrusted?: boolean;
}

export const OVERRIDE_REASON_CATEGORIES = [
  "blocker_lands_separately",
  "urgent_business_need",
  "dependency_data_wrong",
  "separate_branch_or_environment",
  "other",
] as const;

export type OverrideReasonCategory = (typeof OVERRIDE_REASON_CATEGORIES)[number];

export const OVERRIDE_REASON_LABELS: Record<OverrideReasonCategory, string> = {
  blocker_lands_separately: "The blocker lands separately and will not conflict",
  urgent_business_need: "Urgent business need",
  dependency_data_wrong: "The dependency data is wrong",
  separate_branch_or_environment: "This targets a separate branch or environment",
  other: "Other",
};

export type SequencePolicy = "off" | "warn" | "admin_override_only";

export const DEFAULT_SEQUENCE_POLICY: SequencePolicy = "warn";

/** Minimum length of the free-text reason when any finding is a warning. */
export const MIN_OVERRIDE_REASON_LENGTH = 15;

/** How long a stored check stays usable for a confirmation, in minutes. */
export const SEQUENCE_CHECK_TTL_MINUTES = 15;

/** Error codes the run endpoint returns; each carries a fresh `check`. */
export const SEQUENCE_CHECK_REQUIRED = "SEQUENCE_CHECK_REQUIRED";
export const OVERRIDE_NOT_PERMITTED = "OVERRIDE_NOT_PERMITTED";
export const SEQUENCE_STALE = "SEQUENCE_STALE";
