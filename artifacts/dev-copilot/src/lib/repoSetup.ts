import {
  REPO_SETUP_CHOICES,
  readSetupChoice,
  type RepoSetupChoice,
} from '../../../../shared/types/repoSetup.ts';
import type { BaselineEstimate } from '@/services/api';

/**
 * How the connect-time setup choice reads on screen (0048).
 *
 * In `lib/` rather than beside the form because a `.tsx` cannot be tested
 * here: the dev-copilot runner strips types but does not compile JSX, which is
 * why knowledgeQueue.ts and uiStyleView.ts live here too.
 *
 * No model or vendor name appears in any string: the UI says what the work is,
 * never who does it.
 */

export interface SetupOption {
  value: RepoSetupChoice;
  label: string;
  detail: string;
  /** True when choosing this spends money on the model credentials in use. */
  spends: boolean;
}

export const SETUP_OPTIONS: SetupOption[] = [
  {
    value: 'index',
    label: 'Index the code',
    detail:
      'Build a map of the repository so runs can find the right files. Free, and usually a few minutes.',
    spends: false,
  },
  {
    value: 'index_scan',
    label: 'Index the code and scan it for security issues',
    detail:
      'Everything above, then read every source file once and report what it finds. This spends on the model credentials this workspace uses.',
    spends: true,
  },
  {
    value: 'index_scan_review',
    label: 'Index the code, scan it for security issues, and review it',
    detail:
      'Everything above, plus a code review of every source file: correctness, error handling, resource and concurrency problems. This spends on the model credentials this workspace uses.',
    spends: true,
  },
  {
    value: 'none',
    label: 'Nothing for now',
    detail: 'Connect the repository and nothing else. You can start any of these from the repository page later.',
    spends: false,
  },
];

/** Guard against an option list that drifts from the values the server accepts. */
export function offeredChoices(): RepoSetupChoice[] {
  return SETUP_OPTIONS.map((o) => o.value);
}

/**
 * The choice a form should arrive with: the project's remembered default, or
 * the default choice when there is none. Never `none` by accident, because an
 * unreadable stored value falls back to the default rather than to nothing.
 */
export function initialChoice(projectDefault: unknown): RepoSetupChoice {
  return readSetupChoice(projectDefault);
}

/** Whether this choice needs an estimate shown before it can be confirmed. */
export function needsEstimate(choice: RepoSetupChoice): boolean {
  return SETUP_OPTIONS.find((o) => o.value === choice)?.spends ?? false;
}

/**
 * The cost line for an estimate, or the reason there is not one.
 *
 * Deliberately a ceiling rather than a quote, matching the wording the scan's
 * own pre-flight dialog already uses: the estimate assumes an average file at
 * two thirds of the per-file cap, so a repository of small files costs less
 * than the figure shown, which is the direction a number shown before spend
 * should err in.
 */
export function estimateLine(estimate: BaselineEstimate | null | undefined): string | null {
  if (!estimate) return null;
  if (estimate.overCap) {
    return `${estimate.filesTotal.toLocaleString()} files to scan, above the ${estimate.maxFiles.toLocaleString()}-file limit. Connect the repository, then scan a folder at a time from the repository page.`;
  }
  const files = `${estimate.filesTotal.toLocaleString()} ${estimate.filesTotal === 1 ? 'file' : 'files'}`;
  return `About $${estimate.estimatedCostUsd.toFixed(2)} and ~${estimate.estimatedMinutes} min for ${files}. This is a ceiling, not a quote.`;
}

/** Whether the chosen option can be confirmed yet. */
export function canConfirm(
  choice: RepoSetupChoice,
  estimate: BaselineEstimate | null | undefined,
  estimating: boolean,
): boolean {
  if (!needsEstimate(choice)) return true;
  // Real money is spent on this choice, so it cannot be confirmed until the
  // customer has been shown what it will cost, and never when the repository is
  // above the file cap: the server would refuse the scan anyway.
  if (estimating) return false;
  if (!estimate) return false;
  return !estimate.overCap;
}

/** Every value the server accepts, for the guard test. */
export const SERVER_CHOICES: readonly RepoSetupChoice[] = REPO_SETUP_CHOICES;
