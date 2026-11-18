/**
 * The whole-repository code review (0051).
 *
 * A separate vocabulary from the security scan on purpose. Aegis answers "is
 * this exploitable", on the OWASP taxonomy, with critical as its top severity.
 * This answers "is this correct and maintainable", which is a different
 * question, and borrowing the security scale would invite someone to compare a
 * duplicated helper with an injection flaw because both say "high".
 */

export const REVIEW_CATEGORIES = [
  "correctness",
  "error_handling",
  "resource",
  "concurrency",
  "api_contract",
  "maintainability",
  "test_gap",
  "other",
] as const;

export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

/**
 * Three levels, and deliberately no `critical`.
 *
 * A review finding is not a vulnerability. The top of this scale means "this
 * is a defect a reviewer would block a pull request on", which is not the same
 * claim as Aegis's critical, and a shared top level would let the two be read
 * as one queue.
 */
export const REVIEW_SEVERITIES = ["high", "medium", "low"] as const;

export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const REVIEW_SCAN_STATUSES = ["queued", "scanning", "succeeded", "failed"] as const;

export type ReviewScanStatus = (typeof REVIEW_SCAN_STATUSES)[number];

export const REVIEW_FINDING_STATUSES = ["open", "acknowledged"] as const;

export type ReviewFindingStatus = (typeof REVIEW_FINDING_STATUSES)[number];

/** How a category reads on screen. The UI never shows the stored token. */
export const REVIEW_CATEGORY_LABELS: Record<ReviewCategory, string> = {
  correctness: "Correctness",
  error_handling: "Error handling",
  resource: "Resource handling",
  concurrency: "Concurrency",
  api_contract: "API contract",
  maintainability: "Maintainability",
  test_gap: "Test gap",
  other: "Other",
};

/** Read a category back, tolerating anything a model or an older row produced. */
export function readReviewCategory(value: unknown): ReviewCategory {
  return REVIEW_CATEGORIES.includes(value as ReviewCategory) ? (value as ReviewCategory) : "other";
}

/**
 * Read a severity back.
 *
 * Falls back to `low`, not `high`: an unrecognised value is a model that did
 * not follow the contract, and promoting that to the top of a reviewer's queue
 * would be the wrong way to be wrong.
 */
export function readReviewSeverity(value: unknown): ReviewSeverity {
  return REVIEW_SEVERITIES.includes(value as ReviewSeverity) ? (value as ReviewSeverity) : "low";
}
