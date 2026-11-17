/**
 * The one place a git credential is chosen.
 *
 * The sibling of modelKey.ts, and the same rule: nothing outside this file
 * reads GITHUB_TOKEN, AZURE_REPOS_TOKEN or AZURE_REPOS_ORG, and
 * gitToken.guard.test.ts fails the build when something does. Before this
 * there were twenty-one independent reads across ten files, every one of them
 * personal-only, which is why a departing employee's expired token could
 * silently break every run their projects owned.
 *
 * Order, and why:
 *
 *   1. The person's own token, when the workspace permits personal credentials
 *      and they have one. This is FIRST, not a fallback, because the token is
 *      what GitHub attributes the commit to: a workspace token would quietly
 *      move every commit off the person who asked for it. Keeping personal
 *      first is what makes this migration invisible to existing customers.
 *   2. The workspace's token.
 *   3. Nothing, and the caller refuses before touching git.
 *
 * Azure Repos travels with GitHub rather than beside it: nineteen of the
 * twenty-one call sites passed both to `GitService.forRepo`, and a workspace
 * on Azure Repos deserves the same credential ownership a workspace on GitHub
 * gets. Both scopes are read together so one round trip answers for either
 * provider.
 *
 * Later: a GitHub App installation would replace the workspace token here,
 * removing the "whose PAT is it" question entirely. This file is where that
 * swap lands.
 */

import { getConfig, getTeamConfig } from "./configService.js";
import { getWorkspaceSettings } from "./workspaceSettings.js";
import { getTeamForUser } from "./teamService.js";
import type { GitTokenSource } from "../../../../shared/types/agentKey.js";

export interface ResolvedGitCreds {
  /** Shaped for GitService.forRepo, which takes exactly these two. */
  githubToken: string | undefined;
  azureReposToken: string | undefined;
  /** Recorded on the run. The source only, never a token. */
  source: GitTokenSource;
}

/**
 * Resolve git credentials for the user who OWNS the work.
 *
 * Never the actor: a team member pressing Commit on someone else's run must
 * not move the attribution onto their own token. The same rule modelKey.ts
 * follows, and the same trap 0040 and 0042 both hit.
 */
export async function resolveGitCreds(ownerUserId: string): Promise<ResolvedGitCreds> {
  // The workspace is derived here, not passed in. Twenty-one call sites each
  // handing over a team id is twenty-one chances to hand over the ACTOR's
  // workspace instead of the owner's, and the two differ exactly when it
  // matters. One lookup, in one place, cannot be got wrong.
  const teamId = (await getTeamForUser(ownerUserId))?.team.id ?? null;
  const [settings, personalGithub, personalAzure] = await Promise.all([
    getWorkspaceSettings(teamId),
    getConfig(ownerUserId, "GITHUB_TOKEN"),
    getConfig(ownerUserId, "AZURE_REPOS_TOKEN"),
  ]);

  // Either provider's token counts: a GitHub customer has no Azure token and
  // vice versa, so requiring both would send every workspace down the
  // workspace path regardless of what the person saved.
  const hasPersonal = Boolean(personalGithub || personalAzure);
  if (settings.allowPersonalCredentials && hasPersonal) {
    return {
      githubToken: personalGithub || undefined,
      azureReposToken: personalAzure || undefined,
      source: "personal",
    };
  }

  if (teamId == null) {
    // No workspace to fall back to. Report the true source rather than
    // claiming "workspace" for credentials no workspace owns.
    return {
      githubToken: personalGithub || undefined,
      azureReposToken: personalAzure || undefined,
      source: "personal",
    };
  }

  const [workspaceGithub, workspaceAzure] = await Promise.all([
    getTeamConfig(teamId, "GITHUB_TOKEN"),
    getTeamConfig(teamId, "AZURE_REPOS_TOKEN"),
  ]);
  return {
    githubToken: workspaceGithub || undefined,
    azureReposToken: workspaceAzure || undefined,
    source: "workspace",
  };
}

export const NO_GIT_CREDS_MESSAGE_ADMIN =
  "Add repository access in Settings, Workspace, Repository access.";
export const NO_GIT_CREDS_MESSAGE_MEMBER =
  "Ask a workspace admin to add repository access.";

/** Split by audience, for the reason noModelKeyMessage is. */
export function noGitCredsMessage(isAdmin: boolean): string {
  return isAdmin ? NO_GIT_CREDS_MESSAGE_ADMIN : NO_GIT_CREDS_MESSAGE_MEMBER;
}
