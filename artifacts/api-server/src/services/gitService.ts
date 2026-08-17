import { Octokit } from "@octokit/rest";
import { eq } from "drizzle-orm";
import { db, repositoriesTable } from "@workspace/db";
import type { Repository } from "@workspace/db";
import { detectStack, type StackProfile } from "../stack/detector.js";
import { logger } from "../lib/logger.js";
import { queryGraph } from "./graphifyService.js";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";

// ---------------------------------------------------------------------------
// Stack → file extension mapping
// ---------------------------------------------------------------------------

const STACK_EXTENSIONS: Record<string, string[]> = {
  react: [".ts", ".tsx", ".js", ".jsx", ".html", ".scss", ".css"],
  angular: [".ts", ".tsx", ".html", ".scss"],
  vue: [".ts", ".js", ".vue", ".html", ".scss"],
  dotnet: [".cs", ".csproj", ".razor", ".cshtml"],
  "java-spring": [".java", ".xml", ".properties", ".yml", ".yaml"],
  python: [".py", ".toml", ".cfg", ".ini"],
  nodejs: [".ts", ".js", ".mts", ".mjs", ".json"],
};

function stackExtensions(stack: StackProfile): string[] {
  const exts = new Set<string>();
  const buckets = [stack.frontend, stack.backend, stack.language];
  for (const key of buckets) {
    const mapped = STACK_EXTENSIONS[key];
    if (mapped) mapped.forEach((e) => exts.add(e));
  }
  if (exts.size === 0) [".ts", ".js", ".py", ".java", ".cs"].forEach((e) => exts.add(e));
  return [...exts];
}

function matchesKeywords(filePath: string, keywords: string[]): boolean {
  const lower = filePath.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function hasStackExtension(filePath: string, exts: string[]): boolean {
  return exts.some((ext) => filePath.toLowerCase().endsWith(ext));
}

// ---------------------------------------------------------------------------
// Provider-specific git interfaces
// ---------------------------------------------------------------------------

interface GitProviderClient {
  fetchFilePaths(): Promise<string[]>;
  fetchFileContent(path: string): Promise<string>;
  createBranch(branchName: string, fromRef: string): Promise<void>;
  getDefaultBranchSha(): Promise<string>;
  getBranchSha(branchName: string): Promise<string>;
  commitChanges(params: CommitParams): Promise<string>;
  createPullRequest(params: PullRequestParams): Promise<string>;
}

export interface CommitParams {
  branchName: string;
  message: string;
  files: Array<{ path: string; content: string }>;
  /**
   * Base commit the new commit is built on. Defaults to the default branch's
   * HEAD (single-commit-per-branch, the original behavior). Pass the branch's
   * own HEAD to stack a second commit ON the branch (e.g. adding a test script
   * to the existing implementation PR) instead of overwriting it.
   */
  baseSha?: string;
}

export interface PullRequestParams {
  title: string;
  body: string;
  head: string;
  base: string;
}

// ---------------------------------------------------------------------------
// GitHub provider (via @octokit/rest)
// ---------------------------------------------------------------------------

export interface GitCreds {
  githubToken?: string;
  azureReposToken?: string;
}

class GitHubClient implements GitProviderClient {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly defaultBranch: string;

  constructor(repoUrl: string, defaultBranch: string, creds?: GitCreds) {
    this.octokit = new Octokit({ auth: creds?.githubToken });
    this.defaultBranch = defaultBranch;

    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
    if (!match) throw new Error(`Cannot parse GitHub URL: ${repoUrl}`);
    this.owner = match[1];
    this.repo = match[2];
  }

  async fetchFilePaths(): Promise<string[]> {
    const { data } = await this.octokit.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: this.defaultBranch,
      recursive: "1",
    });
    return (data.tree ?? [])
      .filter((item) => item.type === "blob" && item.path)
      .map((item) => item.path as string);
  }

  async fetchFileContent(path: string): Promise<string> {
    const { data } = await this.octokit.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path,
      ref: this.defaultBranch,
    });

    if (Array.isArray(data) || data.type !== "file") return "";
    const content = (data as { content?: string; encoding?: string }).content ?? "";
    const encoding = (data as { encoding?: string }).encoding ?? "base64";
    if (encoding === "base64") {
      return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
    }
    return content;
  }

  async getDefaultBranchSha(): Promise<string> {
    const { data } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.defaultBranch}`,
    });
    return data.object.sha;
  }

  async createBranch(branchName: string, fromRef: string): Promise<void> {
    try {
      await this.octokit.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branchName}`,
        sha: fromRef,
      });
    } catch (err) {
      // 422 "Reference already exists" — the deterministic branch task/<id> is
      // left from an earlier commit or a retry. Reuse it; commitChanges will
      // move it to the new commit.
      if ((err as { status?: number }).status === 422) {
        logger.info({ branchName }, "Branch already exists — reusing");
        return;
      }
      throw err;
    }
  }

  async getBranchSha(branchName: string): Promise<string> {
    const { data } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branchName}`,
    });
    return data.object.sha;
  }

  async commitChanges(params: CommitParams): Promise<string> {
    const baseRef = params.baseSha ?? (await this.getDefaultBranchSha());

    const blobs = await Promise.all(
      params.files.map((f) =>
        this.octokit.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content: f.content,
          encoding: "utf-8",
        }).then((r) => ({ path: f.path, sha: r.data.sha })),
      ),
    );

    const { data: baseCommit } = await this.octokit.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: baseRef,
    });

    const { data: tree } = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseCommit.tree.sha,
      tree: blobs.map((b) => ({
        path: b.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: b.sha,
      })),
    });

    const { data: commit } = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: params.message,
      tree: tree.sha,
      parents: [baseRef],
    });

    // force so a reused branch (task/<id> from a prior commit) can be moved to
    // the new commit even when it isn't a fast-forward. When baseSha is the
    // branch's own HEAD (test-script stacking) this is a fast-forward anyway.
    await this.octokit.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${params.branchName}`,
      sha: commit.sha,
      force: true,
    });

    return commit.sha;
  }

  async createPullRequest(params: PullRequestParams): Promise<string> {
    try {
      const { data } = await this.octokit.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
      });
      return data.html_url;
    } catch (err) {
      // 422 when an open PR already exists for this head branch — reuse it
      // rather than failing the commit.
      if ((err as { status?: number }).status === 422) {
        const { data: existing } = await this.octokit.pulls.list({
          owner: this.owner,
          repo: this.repo,
          head: `${this.owner}:${params.head}`,
          state: "open",
        });
        if (existing.length > 0) {
          logger.info({ head: params.head, url: existing[0].html_url }, "PR already exists — reusing");
          return existing[0].html_url;
        }
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Azure Repos provider (raw REST API)
// ---------------------------------------------------------------------------

class AzureReposClient implements GitProviderClient {
  private readonly org: string;
  private readonly project: string;
  private readonly repoName: string;
  private readonly defaultBranch: string;
  private readonly authHeader: string;

  constructor(repoUrl: string, defaultBranch: string, creds?: GitCreds) {
    this.defaultBranch = defaultBranch;

    const match = repoUrl.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/);
    if (!match) throw new Error(`Cannot parse Azure Repos URL: ${repoUrl}`);
    [, this.org, this.project, this.repoName] = match;

    const pat = creds?.azureReposToken ?? "";
    this.authHeader = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  }

  private get baseUrl(): string {
    return `https://dev.azure.com/${this.org}/${this.project}/_apis/git/repositories/${this.repoName}`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Azure Repos API ${res.status} at ${path}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async fetchFilePaths(): Promise<string[]> {
    const data = await this.request<{ value: Array<{ path: string; isFolder: boolean }> }>(
      `/items?scopePath=/&recursionLevel=Full&versionDescriptor.version=${this.defaultBranch}&api-version=7.1`,
    );
    return (data.value ?? [])
      .filter((item) => !item.isFolder)
      .map((item) => item.path.replace(/^\//, ""));
  }

  async fetchFileContent(path: string): Promise<string> {
    const url = `${this.baseUrl}/items?path=/${path}&versionDescriptor.version=${this.defaultBranch}&api-version=7.1&$format=text`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) return "";
    return res.text();
  }

  async getDefaultBranchSha(): Promise<string> {
    const data = await this.request<{ value: Array<{ objectId: string }> }>(
      `/refs?filter=heads/${this.defaultBranch}&api-version=7.1`,
    );
    const ref = data.value?.[0];
    if (!ref) throw new Error(`Azure Repos: ref heads/${this.defaultBranch} not found`);
    return ref.objectId;
  }

  async createBranch(branchName: string, fromRef: string): Promise<void> {
    // Reuse the deterministic branch if it already exists (prior commit/retry).
    const existing = await this.request<{ value: Array<{ objectId: string }> }>(
      `/refs?filter=heads/${branchName}&api-version=7.1`,
    ).catch(() => ({ value: [] as Array<{ objectId: string }> }));
    if (existing.value?.length) {
      logger.info({ branchName }, "Azure Repos branch already exists — reusing");
      return;
    }
    const OLD_ZERO = "0000000000000000000000000000000000000000";
    await this.request(`/refs?api-version=7.1`, {
      method: "POST",
      body: JSON.stringify([
        {
          name: `refs/heads/${branchName}`,
          oldObjectId: OLD_ZERO,
          newObjectId: fromRef,
        },
      ]),
    });
  }

  async getBranchSha(branchName: string): Promise<string> {
    const data = await this.request<{ value: Array<{ objectId: string }> }>(
      `/refs?filter=heads/${branchName}&api-version=7.1`,
    );
    const ref = data.value?.[0];
    if (!ref) throw new Error(`Azure Repos: ref heads/${branchName} not found`);
    return ref.objectId;
  }

  async commitChanges(params: CommitParams): Promise<string> {
    const baseSha = params.baseSha ?? (await this.getDefaultBranchSha());

    const body = {
      refUpdates: [{ name: `refs/heads/${params.branchName}`, oldObjectId: baseSha }],
      commits: [
        {
          comment: params.message,
          changes: params.files.map((f) => ({
            changeType: "edit",
            item: { path: `/${f.path}` },
            newContent: { content: f.content, contentType: "rawtext" },
          })),
        },
      ],
    };

    const data = await this.request<{ commits: Array<{ commitId: string }> }>(
      `/pushes?api-version=7.1`,
      { method: "POST", body: JSON.stringify(body) },
    );

    return data.commits?.[0]?.commitId ?? "";
  }

  async createPullRequest(params: PullRequestParams): Promise<string> {
    const body = {
      title: params.title,
      description: params.body,
      sourceRefName: `refs/heads/${params.head}`,
      targetRefName: `refs/heads/${params.base}`,
    };

    const data = await this.request<{ pullRequestId: number }>(`/pullrequests?api-version=7.1`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return `https://dev.azure.com/${this.org}/${this.project}/_git/${this.repoName}/pullrequest/${data.pullRequestId}`;
  }
}

// ---------------------------------------------------------------------------
// GitService — public API
// ---------------------------------------------------------------------------

export class GitService {
  private readonly repo: Repository;
  private readonly client: GitProviderClient;

  private constructor(repo: Repository, client: GitProviderClient) {
    this.repo = repo;
    this.client = client;
  }

  static async forRepo(repoId: number, creds?: GitCreds): Promise<GitService> {
    const [repo] = await db
      .select()
      .from(repositoriesTable)
      .where(eq(repositoriesTable.id, repoId));

    if (!repo) throw new Error(`Repository ${repoId} not found`);
    if (!repo.url) {
      throw new Error(
        `Repository ${repoId} has no URL — it needs reconfiguration. Set a valid repository URL and try again.`,
      );
    }

    const provider = (process.env.GIT_PROVIDER ?? repo.provider) as "github" | "azure-repos";
    const client =
      provider === "github"
        ? new GitHubClient(repo.url, repo.defaultBranch, creds)
        : new AzureReposClient(repo.url, repo.defaultBranch, creds);

    const service = new GitService(repo, client);

    const profile = repo.stackProfile as Record<string, string> | null;
    const hasProfile = profile && Object.keys(profile).length > 0 &&
      Object.values(profile).some((v) => v !== "none");

    if (!hasProfile) {
      logger.info({ repoId }, "No stack profile — running first-connection detection");
      await service.connect();
    }

    return service;
  }

  async connect(): Promise<StackProfile> {
    const filePaths = await this.client.fetchFilePaths();
    const stackProfile = await detectStack(filePaths);

    await db
      .update(repositoriesTable)
      .set({ stackProfile })
      .where(eq(repositoriesTable.id, this.repo.id));

    logger.info({ repoId: this.repo.id, stackProfile }, "Stack profile saved on first connection");
    return stackProfile;
  }

  async fetchFileContext(
    taskId: string,
    keywords: string[],
    stack: StackProfile,
  ): Promise<string> {
    const allPaths = await this.client.fetchFilePaths();
    const exts = stackExtensions(stack);

    const ranked = allPaths
      .filter((p) => hasStackExtension(p, exts))
      .map((p) => ({
        path: p,
        score: (matchesKeywords(p, keywords) ? 2 : 0) +
          (keywords.some((kw) => p.toLowerCase().includes(kw.toLowerCase())) ? 1 : 0),
      }))
      .filter((f) => f.score > 0 || allPaths.filter((p) => hasStackExtension(p, exts)).length < 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (ranked.length === 0) {
      logger.warn({ taskId, keywords }, "No matching files found for task context");
      return "";
    }

    const CHAR_LIMIT = 8000;
    let output = "";

    for (const { path } of ranked) {
      if (output.length >= CHAR_LIMIT) break;
      try {
        const content = await this.client.fetchFileContent(path);
        const header = `\n// === ${path} ===\n`;
        const chunk = header + content;
        const remaining = CHAR_LIMIT - output.length;
        output += chunk.slice(0, remaining);
      } catch (err) {
        logger.warn({ path, err }, "Failed to fetch file content — skipping");
      }
    }

    return output.trim();
  }

  /**
   * Graph-aware file context (Graphify). When a usable graph is provided, query
   * it for the most relevant nodes and fetch only those file sections — far
   * fewer tokens than keyword-guessing whole files. Falls back to the keyword
   * method (fetchFileContext) when there's no graph or the query is empty.
   */
  async fetchFileContextWithGraph(
    taskId: string,
    keywords: string[],
    stack: StackProfile,
    graph: GraphifyGraph | null,
  ): Promise<{ context: string; usedGraph: boolean }> {
    if (!graph || !graph.nodes?.length) {
      return { context: await this.fetchFileContext(taskId, keywords, stack), usedGraph: false };
    }

    const results = queryGraph(graph, keywords, 8);
    if (results.length === 0) {
      return { context: await this.fetchFileContext(taskId, keywords, stack), usedGraph: false };
    }

    const sections: string[] = [];
    let totalChars = 0;
    const MAX_CHARS = 6000; // tighter budget — graph context is more precise

    for (const result of results) {
      if (totalChars >= MAX_CHARS) break;
      try {
        const content = await this.fetchFileSection(result.filePath, result.lineStart, result.lineEnd);
        if (content) {
          const header =
            `// ${result.filePath}` +
            (result.lineStart ? ` (lines ${result.lineStart}-${result.lineEnd ?? "+"})` : "") +
            ` [${result.relation}, confidence: ${(result.confidence * 100).toFixed(0)}%]\n`;
          sections.push(header + content);
          totalChars += header.length + content.length;
        }
      } catch {
        // Skip files that can't be fetched — don't fail the run.
      }
    }

    if (sections.length === 0) {
      return { context: await this.fetchFileContext(taskId, keywords, stack), usedGraph: false };
    }
    return { context: sections.join("\n\n---\n\n"), usedGraph: true };
  }

  private async getFileContent(filePath: string): Promise<string> {
    return this.client.fetchFileContent(filePath);
  }

  private async fetchFileSection(filePath: string, lineStart?: number, lineEnd?: number): Promise<string> {
    const content = await this.getFileContent(filePath);
    if (!content) return "";
    if (!lineStart) return content.slice(0, 2000);

    const lines = content.split("\n");
    const start = Math.max(0, lineStart - 5); // 5 lines before
    const end = Math.min(lines.length, (lineEnd ?? lineStart + 40) + 5); // 5 lines after
    return lines.slice(start, end).join("\n");
  }

  async createBranch(taskId: string): Promise<void> {
    const branchName = `task/${taskId}`;
    const sha = await this.client.getDefaultBranchSha();
    await this.client.createBranch(branchName, sha);
    logger.info({ branchName, repoId: this.repo.id }, "Branch created");
  }

  async commitChanges(params: CommitParams): Promise<string> {
    const sha = await this.client.commitChanges(params);
    logger.info({ sha, branch: params.branchName, repoId: this.repo.id }, "Changes committed");
    return sha;
  }

  /** Current HEAD sha of an existing branch (for stacking a follow-up commit). */
  async branchHeadSha(branchName: string): Promise<string> {
    return this.client.getBranchSha(branchName);
  }

  async createPullRequest(params: PullRequestParams): Promise<string> {
    const url = await this.client.createPullRequest(params);
    logger.info({ url, repoId: this.repo.id }, "Pull request created");
    return url;
  }

  get stackProfile(): StackProfile {
    return this.repo.stackProfile as StackProfile;
  }

  get defaultBranch(): string {
    return this.repo.defaultBranch;
  }
}

/**
 * Post a GitHub commit status check for the Aegis security gate
 * (context `blue-mantis/security`). Non-fatal — returns without throwing for a
 * non-GitHub repo, a missing token, or an API/network error, so it never breaks
 * the scan flow. The token is supplied by the caller (fetched per-user via
 * getConfigs) — never logged.
 */
export async function postSecurityStatus(
  repoUrl: string,
  commitHash: string,
  gate: "approved" | "blocked" | "pending",
  details: string,
  githubToken: string | undefined,
): Promise<void> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
  if (!match) return; // not a GitHub URL — skip silently
  if (!githubToken) return;
  const [, owner, repo] = match;

  const state = gate === "approved" ? "success" : gate === "blocked" ? "failure" : "pending";
  const body = {
    state,
    context: "blue-mantis/security",
    description: details.slice(0, 140), // GitHub 140-char limit
    target_url: `https://getbluemantis.com/app/runs/${commitHash}`,
  };

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/statuses/${commitHash}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, owner, repo }, "Aegis GitHub status check failed");
    }
  } catch (err) {
    logger.warn({ err }, "Aegis GitHub status check errored");
  }
}
