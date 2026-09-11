import { logger } from "../lib/logger.js";
import { SECURITY_CHECK_CONTEXT, securityCheckGenreName } from "../../../../shared/types/branding.js";

/**
 * Publishing the Aegis gate decision to the pull request.
 *
 * Its own module, and deliberately free of any database import: gitService
 * cannot be loaded without DATABASE_URL, which would put this logic out of
 * reach of the test suite. That matters more than usual here, because the
 * Azure DevOps request shape is written from the REST documentation and has
 * not yet been exercised against a live organisation — the tests pinning the
 * URL, payload and state mapping are the only check on it until it has.
 */

/**
 * Where and how to publish the Aegis gate decision.
 *
 * The two providers attach the same signal to different objects: GitHub to the
 * commit, Azure DevOps to the pull request. Both are supplied so the caller
 * does not need to know which one matters.
 */
export interface SecurityStatusTarget {
  repoUrl: string;
  /** GitHub's anchor. */
  commitHash: string;
  /** Azure DevOps' anchor — the PR the commit landed on. Null when none exists. */
  prUrl: string | null;
  /** Deep link target for the check's "Details" affordance. */
  runId: number;
  gate: "approved" | "blocked" | "pending";
  details: string;
  creds: { githubToken?: string; azureReposToken?: string };
}

/**
 * What actually happened. Returned rather than swallowed so a caller that has
 * to record whether the external signal moved — the override audit row does —
 * reports the truth instead of inferring it from a provider check of its own.
 */
export type SecurityStatusOutcome =
  | { posted: true; provider: "github" | "azure-repos" }
  | { posted: false; reason: string };

const appBase = (): string => process.env.APP_BASE_URL ?? "https://app.kandryn.com";

/**
 * Publish the Aegis gate decision as a status check on the pull request.
 *
 * Non-fatal by contract: every failure path returns a reason instead of
 * throwing, so a status problem can never fail a scan that already ran. Tokens
 * are supplied by the caller (per-user, via getConfigs) and never logged.
 *
 * Neither provider blocks a merge on its own. GitHub needs the context named in
 * a branch protection rule or ruleset; Azure DevOps needs it named in a branch
 * policy. Posting the status is all Kandryn can do from the outside.
 */
export async function postSecurityStatus(t: SecurityStatusTarget): Promise<SecurityStatusOutcome> {
  if (/github\.com/.test(t.repoUrl)) return postGitHubStatus(t);
  if (/dev\.azure\.com/.test(t.repoUrl)) return postAzureReposStatus(t);
  return { posted: false, reason: "The repository is neither GitHub nor Azure Repos." };
}

async function postGitHubStatus(t: SecurityStatusTarget): Promise<SecurityStatusOutcome> {
  const match = t.repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
  if (!match) return { posted: false, reason: `Could not parse the GitHub repository URL.` };
  if (!t.creds.githubToken) return { posted: false, reason: "No GitHub token is configured." };
  const [, owner, repo] = match;

  const state = t.gate === "approved" ? "success" : t.gate === "blocked" ? "failure" : "pending";
  const body = {
    state,
    context: SECURITY_CHECK_CONTEXT,
    description: t.details.slice(0, 140), // GitHub 140-char limit
    // The run, not the commit. This slot held commitHash, so every "Details"
    // link on every check we ever posted resolved to a run id that does not exist.
    target_url: `${appBase()}/runs/${t.runId}`,
  };

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/statuses/${t.commitHash}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t.creds.githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, owner, repo }, "Aegis GitHub status check failed");
      return { posted: false, reason: `GitHub rejected the status check (HTTP ${res.status}).` };
    }
    return { posted: true, provider: "github" };
  } catch (err) {
    logger.warn({ err }, "Aegis GitHub status check errored");
    return { posted: false, reason: "The GitHub status check could not be sent." };
  }
}

/**
 * Azure DevOps equivalent: a pull request status.
 *
 * Two differences from GitHub matter. It hangs off the pull request rather than
 * the commit, so a run whose PR was never created has nothing to attach to —
 * GitHub would still take the commit status. And the identifier is a
 * {genre, name} pair rather than one string, which ADO renders back as
 * "genre/name" in the branch-policy picker; both come from the same constant.
 *
 * Re-posting the same genre + name updates the existing status, which is what
 * the override flow relies on.
 */
async function postAzureReposStatus(t: SecurityStatusTarget): Promise<SecurityStatusOutcome> {
  const repoMatch = t.repoUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/);
  if (!repoMatch) return { posted: false, reason: "Could not parse the Azure Repos repository URL." };
  if (!t.creds.azureReposToken) return { posted: false, reason: "No Azure Repos token is configured." };

  if (!t.prUrl) {
    return {
      posted: false,
      reason: "Azure DevOps attaches the check to a pull request, and this run has no pull request.",
    };
  }
  const prMatch = t.prUrl.match(/\/pullrequest\/(\d+)/i);
  if (!prMatch) return { posted: false, reason: "Could not read the pull request id from its URL." };

  const [, org, project, repo] = repoMatch;
  const pullRequestId = prMatch[1];
  const { genre, name } = securityCheckGenreName();

  const state = t.gate === "approved" ? "succeeded" : t.gate === "blocked" ? "failed" : "pending";
  const body = {
    state,
    // ADO does not document GitHub's 140-char ceiling, but keeping one limit
    // means the same text reaches a reviewer on either provider.
    description: t.details.slice(0, 140),
    context: { genre, name },
    targetUrl: `${appBase()}/runs/${t.runId}`,
  };

  const url =
    `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}` +
    `/pullRequests/${pullRequestId}/statuses?api-version=7.1`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        // ADO PATs authenticate as Basic with an empty username, the same way
        // AzureReposClient does it.
        Authorization: `Basic ${Buffer.from(`:${t.creds.azureReposToken}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // The body is logged because the likely failure is a PAT scope problem,
      // and ADO explains which one in the response. Settings tells people to
      // create a "Code → Read & Write" token; posting a status may additionally
      // require the status scope and Contribute-to-pull-requests on the repo.
      // Nothing here carries the token itself.
      const detail = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, org, project, repo, pullRequestId, detail: detail.slice(0, 500) },
        "Aegis Azure Repos status check failed",
      );
      return {
        posted: false,
        reason:
          res.status === 401 || res.status === 403
            ? `Azure DevOps refused the status check (HTTP ${res.status}). The Azure Repos token may need the ` +
              `status scope and Contribute to pull requests on this repository.`
            : `Azure DevOps rejected the status check (HTTP ${res.status}).`,
      };
    }
    return { posted: true, provider: "azure-repos" };
  } catch (err) {
    logger.warn({ err }, "Aegis Azure Repos status check errored");
    return { posted: false, reason: "The Azure Repos status check could not be sent." };
  }
}
