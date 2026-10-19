/**
 * Asking a provider whether a pull request actually merged.
 *
 * Kandryn stores `runs.pr_url` but never learns what became of it — there is
 * no webhook and no poll — so the run-order check treats a blocker with an
 * open PR conservatively, as a caution. This is the one place that asks for
 * real: the impact narrative has an 8-second budget and runs only when
 * somebody is about to override, which is exactly when "has it actually
 * landed?" is the question worth a network call.
 *
 * Its own module, free of any database import, following securityStatus.ts —
 * both so the URL parsing is testable and so nothing here can be mistaken for
 * part of the Git adapter, whose behaviour this feature must not change.
 */

import { logger } from "../lib/logger.js";

export type PullRequestState = "merged" | "open" | "closed" | "unknown";

export interface ParsedPullRequest {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Pick the owner, repo and number out of a GitHub pull-request URL. Returns
 * null for anything else, Azure DevOps included — its PR state is simply not
 * read, and the caller reports `unknown` rather than guessing.
 */
export function parseGitHubPullRequestUrl(url: string | null | undefined): ParsedPullRequest | null {
  if (!url) return null;
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(url.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

/** Map GitHub's two fields onto one state. `merged_at` is the authority: a
 *  merged PR is also reported as state "closed". */
export function gitHubStateOf(pr: { state?: string; merged_at?: string | null }): PullRequestState {
  if (pr.merged_at) return "merged";
  if (pr.state === "open") return "open";
  if (pr.state === "closed") return "closed";
  return "unknown";
}

/**
 * The current state of a pull request. Never throws and never blocks: every
 * failure — no token, a non-GitHub URL, a rate limit, a timeout — returns
 * `unknown`, and the narrative simply says less. The token is supplied by the
 * caller from per-user config and is never logged.
 */
export async function fetchPullRequestState(
  prUrl: string | null,
  githubToken: string | undefined,
  signal?: AbortSignal,
): Promise<PullRequestState> {
  const parsed = parseGitHubPullRequestUrl(prUrl);
  if (!parsed || !githubToken) return "unknown";

  try {
    const res = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: signal ?? AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      logger.warn({ status: res.status, pr: parsed.number }, "PR state lookup failed");
      return "unknown";
    }
    return gitHubStateOf((await res.json()) as { state?: string; merged_at?: string | null });
  } catch (err) {
    logger.warn({ err, pr: parsed.number }, "PR state lookup threw");
    return "unknown";
  }
}
