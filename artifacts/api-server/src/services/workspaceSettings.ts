/**
 * The two settings a workspace admin owns, and nobody else.
 *
 * They live as columns on `teams` (0046) rather than in a settings JSON blob,
 * following `audit_retention_days` (0031) and `sequence_policy` (0038): a
 * column can be queried, defaulted and read in one place, and the two settings
 * here are read on the hot path of every run.
 *
 * A user with no workspace gets the defaults through the same function the
 * rest of the code uses, which is the reason those neighbours are nullable
 * rather than defaulted, and the reason this returns a value for `null`.
 */

import { eq } from "drizzle-orm";
import { db, teamsTable } from "@workspace/db";
import {
  DEFAULT_WORKSPACE_AGENT_SOURCE,
  isWorkspaceAgentSource,
  type WorkspaceAgentSource,
} from "../../../../shared/types/agentKey.js";

export interface WorkspaceSettings {
  agentKeySource: WorkspaceAgentSource;
  allowPersonalCredentials: boolean;
}

/**
 * What a user with no workspace gets: their own credentials, always.
 *
 * `allowPersonalCredentials: true` is the whole of it. There is no workspace to
 * have an opinion, so the personal override is the only path that can resolve,
 * and `agentKeySource` is never reached.
 */
const NO_WORKSPACE: WorkspaceSettings = {
  agentKeySource: DEFAULT_WORKSPACE_AGENT_SOURCE,
  allowPersonalCredentials: true,
};

export async function getWorkspaceSettings(teamId: number | null | undefined): Promise<WorkspaceSettings> {
  if (teamId == null) return NO_WORKSPACE;
  const [row] = await db
    .select({
      agentKeySource: teamsTable.agentKeySource,
      allowPersonalCredentials: teamsTable.allowPersonalCredentials,
    })
    .from(teamsTable)
    .where(eq(teamsTable.id, teamId));
  // A team id that resolves to no row is not a workspace either.
  if (!row) return NO_WORKSPACE;
  return {
    agentKeySource: isWorkspaceAgentSource(row.agentKeySource)
      ? row.agentKeySource
      : DEFAULT_WORKSPACE_AGENT_SOURCE,
    allowPersonalCredentials: row.allowPersonalCredentials,
  };
}

/** Write one or both. Callers are responsible for the admin check. */
export async function setWorkspaceSettings(
  teamId: number,
  patch: Partial<WorkspaceSettings>,
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.agentKeySource !== undefined) update.agentKeySource = patch.agentKeySource;
  if (patch.allowPersonalCredentials !== undefined) {
    update.allowPersonalCredentials = patch.allowPersonalCredentials;
  }
  if (Object.keys(update).length === 0) return;
  await db.update(teamsTable).set(update).where(eq(teamsTable.id, teamId));
}
