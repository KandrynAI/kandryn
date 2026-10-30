/**
 * The one place a plan check for the Jira app will go (0043).
 *
 * Phase 1 gates nothing: every signed-in user may use the Jira app. The
 * function exists so that when gating arrives it is added here, called by the
 * two endpoints that already call it, rather than being scattered across the
 * routes at that point.
 */
export async function canUseJiraApp(_userId: string): Promise<boolean> {
  return true;
}
