/**
 * Whether an override is ready to submit.
 *
 * Its own module so it can be tested: a .tsx component cannot be, because the
 * dev-copilot runner strips types but does not compile JSX. This rule is worth
 * testing on its own because getting it wrong in the lenient direction means
 * someone commits a permanent, attributed decision record without having given
 * a reason — and the server's own 400 would then be the only thing standing
 * between them and a confusing dead end.
 */

/** Matches MIN_OVERRIDE_REASON_LENGTH on the server. */
export const MIN_OVERRIDE_REASON = 15;

export function overrideReady(input: {
  category: string;
  reason: string;
  acknowledged: boolean;
  /** True when any current finding is a warning, which makes a reason required. */
  hasWarning: boolean;
  busy?: boolean;
}): boolean {
  if (!input.category) return false;
  if (!input.acknowledged) return false;
  if (input.busy) return false;
  if (input.hasWarning && input.reason.trim().length < MIN_OVERRIDE_REASON) return false;
  return true;
}
