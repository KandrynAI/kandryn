/**
 * Whose credentials a piece of work runs on.
 *
 * Four vocabularies, deliberately distinct, because conflating any two of them
 * is how the wrong party gets billed:
 *
 *   - What a WORKSPACE has chosen for its agents  (WorkspaceAgentSource)
 *   - What a PERSON has chosen for themselves     (PersonalAgentPreference)
 *   - What a RUN actually spent, after resolution (RunKeySource)
 *   - Which git token a RUN actually used         (GitTokenSource)
 *
 * The first two are inputs and the last two are outcomes. A person may prefer
 * their own credentials and still have a run resolve to `workspace`, because
 * the policy forbids personal credentials or because they saved none.
 *
 * Shared because these values travel from Settings to the API, into two team
 * columns and a config row, and back out stamped on every run: more places
 * than any one package can own.
 */

/** A workspace's choice. `workspace_keys` means the credentials it saved itself. */
export type WorkspaceAgentSource = "kandryn" | "workspace_keys";

export const WORKSPACE_AGENT_SOURCES: readonly WorkspaceAgentSource[] = ["kandryn", "workspace_keys"];

/**
 * What a workspace with no stored choice gets.
 *
 * `workspace_keys`, never `kandryn`: a workspace must opt INTO spending
 * Kandryn's money, and a default that did otherwise would enrol every new
 * customer silently.
 */
export const DEFAULT_WORKSPACE_AGENT_SOURCE: WorkspaceAgentSource = "workspace_keys";

/**
 * A person's choice, and the only thing they control.
 *
 * `own` asks to override the workspace with their own saved credentials; it is
 * honoured only where the policy allows it and the credentials exist.
 * `workspace` follows whatever the workspace decided.
 */
export type PersonalAgentPreference = "own" | "workspace";

/**
 * The default, which is `own` for a reason that matters during the migration:
 * before workspace credentials existed, everybody ran on their own keys. A
 * default of `workspace` would move every existing user off their own
 * credentials the moment this ships.
 */
export const DEFAULT_PERSONAL_PREFERENCE: PersonalAgentPreference = "own";

/** Whose model credentials a run actually spent. Stamped on `runs`. */
export type RunKeySource = "personal" | "workspace" | "kandryn";

/** Which git token a run actually used. Stamped on `runs`. */
export type GitTokenSource = "personal" | "workspace";

export function isWorkspaceAgentSource(value: unknown): value is WorkspaceAgentSource {
  return value === "kandryn" || value === "workspace_keys";
}

/**
 * Read a stored personal preference.
 *
 * The retired per-user `kandryn` value reads as `workspace`: that person asked
 * for Kandryn's credentials, which is now a workspace decision, so the honest
 * translation is "follow the workspace" rather than "override with my own".
 * Their workspace's own value was set from its owner's choice by the 0046
 * backfill.
 */
export function readPersonalPreference(value: unknown): PersonalAgentPreference {
  if (value === "own") return "own";
  if (value === "workspace" || value === "kandryn") return "workspace";
  return DEFAULT_PERSONAL_PREFERENCE;
}
