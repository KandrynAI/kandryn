import {
  REVIEW_CATEGORY_LABELS,
  readReviewCategory,
} from '../../../../shared/types/reviewScan.ts';
import type { CodeReviewFinding, CodeReviewScan } from '@/services/api';

/**
 * Display logic for the whole-repository code review (0051).
 *
 * In `lib/` rather than beside the panel because a `.tsx` cannot be tested
 * here: the dev-copilot runner strips types but does not compile JSX. Same
 * reason knowledgeQueue.ts, uiStyleView.ts and repoSetup.ts live here.
 */

/** How a stored category token reads on screen. Never the token itself. */
export function categoryLabel(category: string): string {
  return REVIEW_CATEGORY_LABELS[readReviewCategory(category)];
}

/**
 * The colour for a severity.
 *
 * Amber at the top, not red. A review finding is not a failure or a
 * vulnerability: high means a reviewer would block a pull request, and the
 * security scan's red is reserved for something that can be exploited. Using
 * one palette for both would invite reading the two as one queue.
 */
export function severityColor(severity: string): string {
  if (severity === 'high') return 'var(--c-amber, #b4802a)';
  return 'var(--text-secondary, #8fa39a)';
}

/** Severity order for display: most severe first. */
export const SEVERITY_ORDER = ['high', 'medium', 'low'] as const;

/**
 * The one-line state of a review, in words.
 *
 * Coverage, never a verdict: "reviewed N of M" rather than "passed". The
 * review gates nothing, and a sentence that sounds like a verdict would imply
 * it does.
 */
export function reviewStatusLine(scan: CodeReviewScan | null): string {
  if (!scan) return 'This codebase has not been reviewed yet.';
  switch (scan.status) {
    case 'queued':
      return 'Starting the review.';
    case 'scanning':
      return `Reviewing ${scan.filesTotal.toLocaleString()} files. This runs in the background and usually takes under an hour, so you can leave this page.`;
    case 'failed':
      return scan.error ? `The review did not complete: ${scan.error}` : 'The review did not complete.';
    case 'succeeded': {
      const scope = scan.pathPrefix ? ` in ${scan.pathPrefix}` : '';
      const skipped = scan.filesSkipped > 0 ? `, ${scan.filesSkipped.toLocaleString()} skipped` : '';
      return `Reviewed ${scan.filesReviewed.toLocaleString()} of ${scan.filesTotal.toLocaleString()} files${scope}${skipped}.`;
    }
    default:
      return 'This codebase has not been reviewed yet.';
  }
}

/** Whether a review is still working, so the page should keep asking. */
export function isReviewInFlight(scan: CodeReviewScan | null | undefined): boolean {
  return scan?.status === 'queued' || scan?.status === 'scanning';
}

/** What a finished review cost, or null when it was not priced. */
export function reviewCostLine(scan: CodeReviewScan | null): string | null {
  if (!scan?.actualCostUsd) return null;
  const spent = `$${Number(scan.actualCostUsd).toFixed(2)} spent`;
  if (!scan.estimatedCostUsd) return spent;
  return `${spent} of $${Number(scan.estimatedCostUsd).toFixed(2)} estimated`;
}

/**
 * Findings grouped by severity, most severe first, with acknowledged ones last
 * inside each group.
 *
 * Acknowledged findings are kept rather than hidden: a team that dismissed
 * something with a reason should be able to see that it is still there and
 * still being carried forward, which is what a hidden row would conceal.
 */
export function groupFindings(
  findings: CodeReviewFinding[],
): { severity: string; findings: CodeReviewFinding[] }[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    findings: findings
      .filter((f) => f.severity === severity)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        return a.filePath.localeCompare(b.filePath);
      }),
  })).filter((g) => g.findings.length > 0);
}

/** How many findings still need a decision. */
export function openCount(findings: CodeReviewFinding[]): number {
  return findings.filter((f) => f.status === 'open').length;
}

/**
 * Whether a dismissal can be submitted.
 *
 * Pinned to the server's rule, which requires a non-empty reason and enforces
 * it with a database CHECK as well. An enabled button the server then rejects
 * is worse than a disabled one.
 */
export function canAcknowledge(reason: string): boolean {
  return reason.trim().length > 0;
}
