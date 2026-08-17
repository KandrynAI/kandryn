import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, repositoriesTable } from "@workspace/db";
import {
  CreateRepositoryBody,
  UpdateRepositoryBody,
  GetRepositoryParams,
  UpdateRepositoryParams,
  DeleteRepositoryParams,
  DetectRepositoryStackParams,
  DetectRepositoryStackResponse,
  ListRepositoriesResponse,
  GetRepositoryResponse,
  UpdateRepositoryResponse,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import { detectStack } from "../stack/detector.js";
import { fetchFilePaths } from "../adapters/gitService.js";
import { GitService } from "../services/gitService.js";
import { getConfigs } from "../services/configService.js";
import { isGraphUsable, isGraphifyConfigured, triggerRepoIndex } from "../services/graphifyService.js";
import * as audit from "../services/auditService.js";

const router: IRouter = Router();

const RepoIdParam = z.object({ repoId: z.coerce.number().int().positive() });

// https://github.com/{owner}/{repo}, tolerating a www. prefix, a .git suffix,
// and a trailing slash. Anchored so nothing but owner/repo may follow the host.
const GITHUB_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

type UrlCheck = { ok: true; defaultBranch: string } | { ok: false; error: string };

/**
 * Verify a GitHub repository URL by existence, not shape (PART 1): parse
 * owner/repo, then confirm GitHub returns the repository for the user's token
 * via GET /repos/{owner}/{repo}. The URL shape is not the signal — whether
 * GitHub returns the repo is. (A profile repo like owner/owner is legitimate.)
 * Only GitHub URLs are verified.
 */
async function verifyGithubUrl(url: string, token: string | undefined): Promise<UrlCheck> {
  const match = url.match(GITHUB_URL_RE);
  if (!match) {
    return { ok: false, error: "Enter a GitHub repository URL like https://github.com/owner/repo." };
  }
  const [, owner, repo] = match;
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "blue-mantis",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    return { ok: false, error: "Could not reach GitHub to verify the repository. Try again." };
  }
  if (res.status === 401) {
    return { ok: false, error: "GitHub token is invalid — check Settings → Personal." };
  }
  if (res.status === 404) {
    return { ok: false, error: "Repository not found or the token cannot access it." };
  }
  if (!res.ok) {
    return { ok: false, error: `GitHub could not verify the repository (HTTP ${res.status}).` };
  }
  const data = (await res.json()) as { default_branch?: string };
  return { ok: true, defaultBranch: data.default_branch ?? "main" };
}

// Graphify graph.json upload (developer runs Graphify locally, uploads here).
const GraphUploadBody = z.object({
  graph: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        sourceFile: z.string().optional(),
        sourceLocation: z.string().optional(),
        fileType: z.string().optional(),
        degree: z.number().optional(),
        community: z.number().optional(),
      }),
    ),
    edges: z.array(
      z.object({
        source: z.string(),
        target: z.string(),
        relation: z.string(),
        confidence: z.string(),
      }),
    ),
    metadata: z
      .object({ files: z.number(), nodes: z.number(), edges: z.number() })
      .passthrough(),
  }),
});

router.get("/repositories/:repoId/stack", async (req, res): Promise<void> => {
  const params = DetectRepositoryStackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(
      and(
        eq(repositoriesTable.id, params.data.repoId),
        eq(repositoriesTable.userId, req.userId),
      ),
    );

  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  if (!repo.url) {
    res.status(400).json({ error: "Repository needs reconfiguration — set a valid repository URL first." });
    return;
  }

  const gitCreds = await getConfigs(req.userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
  req.log.info({ repoId: repo.id, provider: repo.provider }, "Fetching file list for stack detection");
  const filePaths = await fetchFilePaths(repo.provider, repo.url, repo.defaultBranch, {
    githubToken: gitCreds.GITHUB_TOKEN,
    azureReposToken: gitCreds.AZURE_REPOS_TOKEN,
  });

  const stackProfile = await detectStack(filePaths);

  await db
    .update(repositoriesTable)
    .set({ stackProfile })
    .where(eq(repositoriesTable.id, repo.id));

  req.log.info({ repoId: repo.id, stackProfile }, "Stack profile saved");
  res.json(DetectRepositoryStackResponse.parse(stackProfile));
});

router.get("/repositories", async (req, res): Promise<void> => {
  const repos = await db
    .select()
    .from(repositoriesTable)
    .where(eq(repositoriesTable.userId, req.userId))
    .orderBy(repositoriesTable.createdAt);
  res.json(ListRepositoriesResponse.parse(repos));
});

router.post("/repositories", async (req, res): Promise<void> => {
  const parsed = CreateRepositoryBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid request body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Verify the URL by existence before saving so a non-existent or inaccessible
  // repo can never be persisted (PART 1). Azure Repos URLs are not verified.
  let verifiedBranch: string | undefined;
  if (parsed.data.provider === "github") {
    const { GITHUB_TOKEN } = await getConfigs(req.userId, ["GITHUB_TOKEN"]);
    const check = await verifyGithubUrl(parsed.data.url, GITHUB_TOKEN);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    verifiedBranch = check.defaultBranch;
  }

  const [repo] = await db
    .insert(repositoriesTable)
    .values({
      ...(parsed.data as typeof repositoriesTable.$inferInsert),
      userId: req.userId,
      defaultBranch: verifiedBranch ?? parsed.data.defaultBranch,
      stackProfile: {},
    })
    .returning();

  try {
    const gitCredsConnect = await getConfigs(req.userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
    const gitService = await GitService.forRepo(repo.id, {
      githubToken: gitCredsConnect.GITHUB_TOKEN,
      azureReposToken: gitCredsConnect.AZURE_REPOS_TOKEN,
    });
    req.log.info({ repoId: repo.id, stackProfile: gitService.stackProfile }, "Stack detected on connect");
  } catch (err) {
    req.log.warn({ repoId: repo.id, err }, "GitService stack detection failed — repo saved without profile");
  }

  const [updated] = await db
    .select()
    .from(repositoriesTable)
    .where(eq(repositoriesTable.id, repo.id));

  // Trigger async Graphify indexing if the microservice is configured
  // (Phase 2). Fire-and-forget — never blocks the response.
  if (isGraphifyConfigured() && updated.url) {
    const cfg = await getConfigs(req.userId, ["GITHUB_TOKEN"]);
    triggerRepoIndex({ repoUrl: updated.url, githubToken: cfg.GITHUB_TOKEN ?? "", repoId: updated.id, log: req.log });
  }

  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "repository.connected",
    entityType: "repository",
    entityId: updated.id,
    metadata: { name: updated.name, provider: updated.provider },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.status(201).json(GetRepositoryResponse.parse(updated));
});

router.get("/repositories/:id", async (req, res): Promise<void> => {
  const params = GetRepositoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(
      and(eq(repositoriesTable.id, params.data.id), eq(repositoriesTable.userId, req.userId)),
    );
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  res.json(GetRepositoryResponse.parse(repo));
});

router.patch("/repositories/:id", async (req, res): Promise<void> => {
  const params = UpdateRepositoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRepositoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(repositoriesTable)
    .where(and(eq(repositoriesTable.id, params.data.id), eq(repositoriesTable.userId, req.userId)));
  if (!existing) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  const provider = parsed.data.provider ?? existing.provider;
  const urlChanged = parsed.data.url != null && parsed.data.url !== existing.url;

  // Verify a changed GitHub URL by existence before saving (PART 1).
  let verifiedBranch: string | undefined;
  if (urlChanged && provider === "github") {
    const { GITHUB_TOKEN } = await getConfigs(req.userId, ["GITHUB_TOKEN"]);
    const check = await verifyGithubUrl(parsed.data.url as string, GITHUB_TOKEN);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    verifiedBranch = check.defaultBranch;
  }

  const updates: Partial<typeof repositoriesTable.$inferInsert> = {
    ...(parsed.data as Partial<typeof repositoriesTable.$inferInsert>),
  };
  // A new URL invalidates the detected stack and clears the reconfiguration flag;
  // the stack is re-detected below. Adopt the verified default branch.
  if (urlChanged) {
    updates.stackProfile = {};
    updates.needsReconfiguration = false;
    if (verifiedBranch) updates.defaultBranch = verifiedBranch;
  }

  const [repo] = await db
    .update(repositoriesTable)
    .set(updates)
    .where(and(eq(repositoriesTable.id, params.data.id), eq(repositoriesTable.userId, req.userId)))
    .returning();
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  // Re-detect the stack against the new URL (best-effort; mirrors connect). With
  // stackProfile cleared above, GitService.forRepo re-runs detection.
  if (urlChanged) {
    try {
      const creds = await getConfigs(req.userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
      await GitService.forRepo(repo.id, {
        githubToken: creds.GITHUB_TOKEN,
        azureReposToken: creds.AZURE_REPOS_TOKEN,
      });
    } catch (err) {
      req.log.warn({ repoId: repo.id, err }, "Stack re-detection after URL change failed");
    }
  }

  const [updated] = await db
    .select()
    .from(repositoriesTable)
    .where(eq(repositoriesTable.id, repo.id));
  res.json(UpdateRepositoryResponse.parse(updated));
});

// ---------------------------------------------------------------------------
// GET /repositories/:repoId/graph — Graphify graph status (meta only).
// ---------------------------------------------------------------------------
router.get("/repositories/:repoId/graph", async (req, res): Promise<void> => {
  const params = RepoIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid repository id" });
    return;
  }
  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(and(eq(repositoriesTable.id, params.data.repoId), eq(repositoriesTable.userId, req.userId)));
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  res.json({
    built: repo.graphBuiltAt != null,
    builtAt: repo.graphBuiltAt,
    nodeCount: repo.graphNodeCount,
    stale: repo.graphBuiltAt != null && !isGraphUsable(repo.graphBuiltAt),
  });
});

// ---------------------------------------------------------------------------
// POST /repositories/:repoId/graph — store an uploaded graph.json.
// ---------------------------------------------------------------------------
router.post("/repositories/:repoId/graph", async (req, res): Promise<void> => {
  const params = RepoIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid repository id" });
    return;
  }
  const parsed = GraphUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid graph payload" });
    return;
  }
  const graph = parsed.data.graph;
  if (graph.nodes.length === 0) {
    res.status(400).json({ error: "Graph is empty." });
    return;
  }

  const [updated] = await db
    .update(repositoriesTable)
    .set({
      graphJson: graph as typeof repositoriesTable.$inferInsert.graphJson,
      graphBuiltAt: new Date(),
      graphNodeCount: graph.nodes.length,
    })
    .where(and(eq(repositoriesTable.id, params.data.repoId), eq(repositoriesTable.userId, req.userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  req.log.info({ repoId: updated.id, nodes: graph.nodes.length }, "Graphify graph stored");
  res.json({
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    message: `Graph loaded: ${graph.nodes.length} nodes, ${graph.edges.length} edges.`,
  });
});

// ---------------------------------------------------------------------------
// POST /repositories/:repoId/graph/rebuild — ask the microservice to re-index
// this repo (Phase 3). 202 accepted; the graph updates via the callback. 503
// when the microservice isn't configured for this deployment.
// ---------------------------------------------------------------------------
router.post("/repositories/:repoId/graph/rebuild", async (req, res): Promise<void> => {
  const params = RepoIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid repository id" });
    return;
  }
  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(and(eq(repositoriesTable.id, params.data.repoId), eq(repositoriesTable.userId, req.userId)));
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  if (!repo.url) {
    res.status(400).json({ error: "Repository needs reconfiguration — set a valid repository URL first." });
    return;
  }
  if (!isGraphifyConfigured()) {
    res.status(503).json({
      error: "Graphify service is not configured. Upload a graph.json manually, or set GRAPHIFY_SERVICE_URL.",
    });
    return;
  }

  const cfg = await getConfigs(req.userId, ["GITHUB_TOKEN"]);
  triggerRepoIndex({ repoUrl: repo.url, githubToken: cfg.GITHUB_TOKEN ?? "", repoId: repo.id, log: req.log });
  req.log.info({ repoId: repo.id }, "Graphify rebuild triggered");
  res.status(202).json({ status: "indexing", message: "Rebuild started — the graph will update shortly." });
});

router.delete("/repositories/:id", async (req, res): Promise<void> => {
  const params = DeleteRepositoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [repo] = await db
    .delete(repositoriesTable)
    .where(
      and(eq(repositoriesTable.id, params.data.id), eq(repositoriesTable.userId, req.userId)),
    )
    .returning();
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "repository.deleted",
    entityType: "repository",
    entityId: repo.id,
    metadata: { name: repo.name },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.sendStatus(204);
});

export default router;
