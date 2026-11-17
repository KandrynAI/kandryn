/**
 * The rules behind the workspace and personal credential choices, with no markup.
 *
 * Extracted for the reason overrideReady.ts and uiStyleView.ts are: the
 * dev-copilot runner strips types but does not compile JSX, so logic inside a
 * .tsx cannot be tested at all. What is worth testing here is which of several
 * unavailable cases wins, and that each one says something true to the person
 * reading it.
 */

import type { AgentPreferenceState, WorkspaceSettingsState } from '@/services/api';

export type WorkspaceAgentSource = 'kandryn' | 'workspace_keys';
export type PersonalPreference = 'own' | 'workspace';

export const WORKSPACE_SOURCE_LABEL: Record<WorkspaceAgentSource, string> = {
  kandryn: 'Use Kandryn Agents',
  workspace_keys: 'Use our own credentials',
};

export const WORKSPACE_SOURCE_HELP: Record<WorkspaceAgentSource, string> = {
  kandryn: 'Kandryn supplies the credentials for Raptia and Fovea. Nothing to set up.',
  workspace_keys: 'Raptia and Fovea run on the credentials saved below.',
};

/** Said once, above the choice, because it is true of either option. */
export const SOURCE_TAKES_EFFECT_NEXT_RUN =
  'A change here applies to the next run. Runs already in flight finish on the credentials they started with.';

/** Shown before an admin turns the policy off, so the consequence is not a surprise. */
export const POLICY_OFF_NOTE =
  'Members keep any credentials they have saved. They simply stop being used.';

export const MEMBER_READ_ONLY_NOTE = 'Only workspace admins can change these settings.';

/** What My account says in place of the credential cards, when policy forbids them. */
export const MANAGED_BY_WORKSPACE = 'Agent credentials are managed by your workspace.';

/**
 * Why the Kandryn option cannot be chosen, or null when it can.
 *
 * Availability is checked before permission on purpose: a deployment with no
 * platform credentials cannot serve anyone, so telling one admin it is "not
 * available on this account" would send them to support over an environment
 * variable. Both are cautions, never failures.
 */
export function kandrynBlockedReason(state: { platformAvailable: boolean } | null): string | null {
  if (!state) return null;
  if (!state.platformAvailable) return 'Kandryn Agents is not available in this environment.';
  return null;
}

/** Whether this workspace option can be selected right now. */
export function canSelectWorkspaceSource(
  option: WorkspaceAgentSource,
  state: WorkspaceSettingsState | null,
  saving: boolean,
): boolean {
  if (!state || saving || !state.canEdit) return false;
  if (option === 'workspace_keys') return true;
  return kandrynBlockedReason(state) === null;
}

/**
 * Whether My account should show the personal credential sections at all.
 *
 * Hidden rather than disabled when the policy forbids them: a disabled field
 * for a credential that would never be read invites someone to fill it in and
 * then wonder why nothing changed.
 */
export function showsPersonalCredentials(state: AgentPreferenceState | null): boolean {
  if (!state) return false;
  // With no workspace there is nobody to forbid it, and personal credentials
  // are the only ones that exist.
  if (!state.hasWorkspace) return true;
  return state.allowPersonalCredentials;
}

/** The one line shown in their place when they are hidden. */
export function personalCredentialsHiddenNote(state: AgentPreferenceState | null): string | null {
  return showsPersonalCredentials(state) ? null : MANAGED_BY_WORKSPACE;
}
