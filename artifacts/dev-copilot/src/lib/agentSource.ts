/**
 * The rules behind the "Use Kandryn Agents" choice, with no markup.
 *
 * Extracted for the reason overrideReady.ts and uiStyleView.ts are: the
 * dev-copilot runner strips types but does not compile JSX, so anything inside
 * a .tsx cannot be tested at all. What is worth testing here is which of the
 * four unavailable cases wins, and that each one says something true.
 */

import type { AgentKeySourceState } from '@/services/api';

export type AgentSource = 'own' | 'kandryn';

export const AGENT_SOURCE_LABEL: Record<AgentSource, string> = {
  own: 'Use my own credentials',
  kandryn: 'Use Kandryn Agents',
};

export const AGENT_SOURCE_HELP: Record<AgentSource, string> = {
  own: 'Raptia and Fovea run on the credentials you save below.',
  kandryn: 'Kandryn supplies the credentials for Raptia and Fovea. Nothing to set up.',
};

/** Shown in place of the credential cards once Kandryn Agents is selected. */
export const OWN_KEYS_KEPT =
  'Your own credentials are saved and will be used again if you switch back.';

/**
 * Why the Kandryn option cannot be chosen, or null when it can.
 *
 * Availability is checked before entitlement on purpose: a deployment with no
 * platform credentials cannot serve anyone, so telling one user it is "not
 * available on this account" would send them to support over an environment
 * variable. Both are cautions, never failures.
 */
export function kandrynBlockedReason(state: AgentKeySourceState | null): string | null {
  if (!state) return null;
  if (!state.platformAvailable) return 'Kandryn Agents is not available in this environment.';
  if (!state.entitled) return 'Kandryn Agents is not available on this account.';
  return null;
}

/** Whether the radio accepts input at all. */
export function canChange(state: AgentKeySourceState | null, saving: boolean): boolean {
  if (!state || saving) return false;
  // Switching back to your own keys is always allowed, even where the Kandryn
  // option is blocked: a user stranded in a mode this deployment cannot serve
  // must be able to leave it.
  return true;
}

/** Whether this particular option can be selected right now. */
export function canSelect(
  option: AgentSource,
  state: AgentKeySourceState | null,
  saving: boolean,
): boolean {
  if (!canChange(state, saving)) return false;
  if (option === 'own') return true;
  return kandrynBlockedReason(state) === null;
}
