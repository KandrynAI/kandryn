/**
 * The parts of git-credential resolution that are pure functions of their
 * input: the refusal messages, and whether a write may proceed.
 *
 * Split out of gitToken.ts so they can be unit-tested without a DATABASE_URL,
 * the same split graphUsability.ts makes out of graphifyService.ts and
 * baselineScanCore.ts out of baselineScanService.ts. gitToken re-exports
 * everything here, so callers import from one place.
 */

export const NO_GIT_CREDS_MESSAGE_ADMIN =
  "Add repository access in Settings, Workspace, Repository access.";
export const NO_GIT_CREDS_MESSAGE_MEMBER =
  "Ask a workspace admin to add repository access.";

/** Split by audience, for the reason noModelKeyMessage is. */
export function noGitCredsMessage(isAdmin: boolean): string {
  return isAdmin ? NO_GIT_CREDS_MESSAGE_ADMIN : NO_GIT_CREDS_MESSAGE_MEMBER;
}

/**
 * Why a git WRITE cannot proceed, or null when it can.
 *
 * This exists because `noGitCredsMessage` shipped with 0046 and was called by
 * NOTHING, so every write path built an unauthenticated client and let the
 * provider answer. GitHub returns 404 for a repository an anonymous caller
 * cannot see, so a customer with no token got "Not Found" and a documentation
 * link about git refs, for a problem entirely about credentials. Confirmed in
 * production on run #42: the response carried `x-ratelimit-limit: 60`, which
 * is GitHub's anonymous ceiling and therefore proof no token was sent.
 *
 * Only WRITES are refused. A read against a public repository genuinely works
 * with no token, and `verifyGithubUrl` relies on that at connect time, so
 * refusing reads would break public repositories outright.
 *
 * Checked per provider: an Azure Repos repository is not reachable with a
 * GitHub token, and conflating them would report the wrong remedy.
 */
export function gitWriteRefusal(
  creds: { githubToken: string | undefined; azureReposToken: string | undefined },
  provider: string,
  isAdmin: boolean,
): string | null {
  const token = provider === "azure-repos" ? creds.azureReposToken : creds.githubToken;
  if (token) return null;
  const which = provider === "azure-repos" ? "Azure Repos" : "GitHub";
  return `No ${which} credentials are available for this repository. ${noGitCredsMessage(isAdmin)}`;
}
