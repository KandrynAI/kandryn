/**
 * Whose credentials a user's model calls run on.
 *
 * `own` is today's behaviour and the default: the keys the person saved in
 * Settings. `kandryn` means the platform's own keys, read from the server
 * environment, never sent to a browser and never stored in the database.
 *
 * Shared because the value travels from the Settings screen to the API, is
 * stored as a config row, and is stamped on every run: four places in three
 * packages that cannot import each other's internals.
 */

export type AgentKeySource = "own" | "kandryn";

export const AGENT_KEY_SOURCES: readonly AgentKeySource[] = ["own", "kandryn"];

/** What a user with no stored preference gets. Never change this to "kandryn". */
export const DEFAULT_AGENT_KEY_SOURCE: AgentKeySource = "own";

export function isAgentKeySource(value: unknown): value is AgentKeySource {
  return value === "own" || value === "kandryn";
}
