import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, repositoriesTable, projectsTable } from "@workspace/db";
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
import { resolveGitCreds } from "../services/gitToken.js";
import {
  isGraphUsable,
  isGraphifyConfigured,
  isIndexInFlight,
  triggerRepoIndex,
} from "../services/graphifyService.js";
import { canAdminister } from "../services/resourceAdmin.js";
import { discoverFiles, estimateScan } from "../services/baselineScanCore.js";
import {
  DEFAULT_SETUP_CHOICE,
  REPO_SETUP_CHOICES,
  readSetupChoice,
  needsDispatch,
  wantsIndex,
} from "../../../../shared/types/repoSetup.js";
import { resetProfile } from "../services/uiStyleService.js";
import * as audit from "../services/auditService.js";

const router: IRouter = Router();

const RepoIdParam = z.object({ repoId: z.coerce.number().int().positive() });

/**
 * The connect-time setup choice (0048), parsed on its own.
 *
 * CreateRepositoryBody comes from the orval codegen and is marked do not edit
 * manually, so this rides alongside it rather than being added to the OpenAPI
 * spec, which is the convention for newer fields here. Optional: a client that
 * does not send it gets the project's remembered default, and failing that the
 * default choice, which is what connect already did.
 */
const SetupField = z.object({ setup: z.enum(REPO_SETUP_CHOICES).optional() });

/** The URL to estimate a scan for, before any repository row exists. */
const EstimateBody = z.object({
  url: z.string().min(1),
  provider: z.enum(["github", "azure-repos"]),
  defaultBranch: z.string().min(1).optional(),
});

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
        "User-Agent": "Kandryn",
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

  const gitCreds = await resolveGitCreds(req.userId);
  req.log.info({ repoId: repo.id, provider: repo.provider }, "Fetching file list for stack detection");
  const filePaths = await fetchFilePaths(repo.provider, repo.url, repo.defaultBranch, {
    githubToken: gitCreds.githubToken,
    azureReposToken: gitCreds.azureReposToken,
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
  // Repositories are project-owned (repositories.project_id). When a projectId is
  // supplied the list is scoped to that project; otherwise all of the user's
  // repositories are returned (legacy/admin views).
  const projectId = z.coerce.number().int().positive().optional().safeParse(req.query.projectId);
  const where =
    projectId.success && projectId.data != null
      ? and(eq(repositoriesTable.userId, req.userId), eq(repositoriesTable.projectId, projectId.data))
      : eq(repositoriesTable.userId, req.userId);
  const repos = await db
    .select()
    .from(repositoriesTable)
    .where(where)
    .orderBy(repositoriesTable.createdAt);
  res.json(ListRepositoriesResponse.parse(repos));
});

/**
 * What a baseline scan of this URL would cost, before any repository row
 * exists (0048).
 *
 * The connect-time choice offers a security scan of the whole codebase, and
 * that choice is only meaningful with a number beside it. The existing
 * estimate endpoint takes a repository id, which there is not one of yet, so
 * this one takes the URL the customer has just typed.
 *
 * It does no more than connect itself already does: verify the URL, read the
 * tree once, and run the same pure discovery and pricing functions the scan
 * uses (services/baselineScanCore.ts), so the figure here and the figure in
 * the scan's own pre-flight dialog cannot disagree. Nothing is written and no
 * model is called.
 *
 * `source` is always "tree": there is no graph for a repository that has not
 * been connected, so the count is the extension filter's, which is the higher
 * of the two and therefore the safe direction for a number shown before spend.
 */
router.post("/repositories/estimate", async (req, res): Promise<void> => {
  const parsed = EstimateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A repository URL and provider are required." });
    return;
  }
  const { githubToken, azureReposToken } = await resolveGitCreds(req.userId);

  let branch = parsed.data.defaultBranch;
  if (parsed.data.provider === "github") {
    const check = await verifyGithubUrl(parsed.data.url, githubToken);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    branch = check.defaultBranch;
  }
  if (!branch) {
    res.status(400).json({ error: "A default branch is required to estimate an Azure Repos repository." });
    return;
  }

  const tree = await fetchFilePaths(parsed.data.provider, parsed.data.url, branch, {
    githubToken,
    azureReposToken,
  });
  if (tree.length === 0) {
    // Either the branch is wrong or the token cannot read the tree. Saying so
    // beats quoting a confident $0.00 for a repository nobody can read.
    res.status(422).json({
      error: "No files could be read from that repository. Check the URL, the branch and your repository access.",
    });
    return;
  }
  const { paths, source } = discoverFiles(null, tree);
  res.json({ ...estimateScan(paths.length), source, treeFileCount: tree.length });
});

router.post("/repositories", async (req, res): Promise<void> => {
  const parsed = CreateRepositoryBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid request body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // A repository is connected inside a project (repositories.project_id is the
  // source of truth for the binding). projectId is required and must be a project
  // the user owns.
  if (parsed.data.projectId == null) {
    res.status(400).json({ error: "projectId is required — connect a repository from within a project." });
    return;
  }
  const [project] = await db
    .select({ id: projectsTable.id, setupChoice: projectsTable.setupChoice })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, parsed.data.projectId), eq(projectsTable.userId, req.userId)));
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  // Verify the URL by existence before saving so a non-existent or inaccessible
  // repo can never be persisted (PART 1). Azure Repos URLs are not verified.
  let verifiedBranch: string | undefined;
  if (parsed.data.provider === "github") {
    const { githubToken } = await resolveGitCreds(req.userId);
    const check = await verifyGithubUrl(parsed.data.url, githubToken);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    verifiedBranch = check.defaultBranch;
  }

  // What to do with the repository once it is connected (0048). An explicit
  // choice from the form wins; otherwise the project's remembered default from
  // the wizard; otherwise the default, which is what connect already did.
  const setupField = SetupField.safeParse(req.body);
  const setup = setupField.success && setupField.data.setup
    ? setupField.data.setup
    : readSetupChoice(project.setupChoice ?? DEFAULT_SETUP_CHOICE);

  const [repo] = await db
    .insert(repositoriesTable)
    .values({
      ...(parsed.data as typeof repositoriesTable.$inferInsert),
      userId: req.userId,
      projectId: project.id,
      defaultBranch: verifiedBranch ?? parsed.data.defaultBranch,
      stackProfile: {},
      setupChoice: setup,
      // Only a choice that asks for a scan or a review leaves work for the
      // dispatcher. `none` and `index` are settled in this request, so they
      // are stamped here rather than being read on every tick for ever.
      setupCompletedAt: needsDispatch(setup) ? null : new Date(),
    })
    .returning();

  try {
    const gitCredsConnect = await resolveGitCreds(req.userId);
    const gitService = await GitService.forRepo(repo.id, {
      githubToken: gitCredsConnect.githubToken,
      azureReposToken: gitCredsConnect.azureReposToken,
    });
    req.log.info({ repoId: repo.id, stackProfile: gitService.stackProfile }, "Stack detected on connect");
  } catch (err) {
    req.log.warn({ repoId: repo.id, err }, "GitService stack detection failed — repo saved without profile");
  }

  const [updated] = await db
    .select()
    .from(repositoriesTable)
    .where(eq(repositoriesTable.id, repo.id));

  // Index the repository, unless the customer asked us not to (0048). Awaited:
  // the handoff used to be fire-and-forget, which on @vercel/node means the
  // request can be frozen before it leaves, and a failed handoff now parks the
  // row as `queued` for the dispatcher instead of leaving it reading
  // `indexing` for an index that never started.
  if (wantsIndex(setup) && isGraphifyConfigured() && updated.url) {
    const cfg = await resolveGitCreds(req.userId);
    await triggerRepoIndex({
      repoUrl: updated.url,
      githubToken: cfg.githubToken ?? "",
      repoId: updated.id,
      triggeredBy: req.userId,
      log: req.log,
    });
  }

  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "repository.connected",
    entityType: "repository",
    entityId: updated.id,
    metadata: { name: updated.name, provider: updated.provider, setup },
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
  // When opened under a project (/p/:projectId/repositories/:id), the repo must
  // belong to that project — otherwise a repo is reachable through a project that
  // doesn't own it. 404 on mismatch.
  const scopeProjectId = z.coerce.number().int().positive().optional().safeParse(req.query.projectId);
  if (scopeProjectId.success && scopeProjectId.data != null && repo.projectId !== scopeProjectId.data) {
    res.status(404).json({ error: "Repository not found in this project" });
    return;
  }
  res.json(GetRepositoryResponse.parse(repo));
});

// POST /repositories/:id/verify — clear the needs_verification flag once the
// user has confirmed a migration-cloned repo points at the right codebase.
router.post("/repositories/:id/verify", async (req, res): Promise<void> => {
  const params = GetRepositoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [repo] = await db
    .update(repositoriesTable)
    .set({ needsVerification: false })
    .where(and(eq(repositoriesTable.id, params.data.id), eq(repositoriesTable.userId, req.userId)))
    .returning();
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
    const { githubToken } = await resolveGitCreds(req.userId);
    const check = await verifyGithubUrl(parsed.data.url as string, githubToken);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    verifiedBranch = check.defaultBranch;
  }

  const updates: Partial<typeof repositoriesTable.$inferInsert> = {
    ...(parsed.data as Partial<typeof repositoriesTable.$inferInsert>),
  };
  // A new URL invalidates the detected stack and clears the reconfiguration and
  // verification flags; the stack is re-detected below. Adopt the verified branch.
  // It also invalidates the Graphify graph: the existing graph was built against
  // the OLD content, so mark it `stale` — retrieval refuses a stale graph and
  // falls back to tree-only planning until a rebuild succeeds. The graph_json is
  // kept (not deleted) for reference; only its status gates usage.
  if (urlChanged) {
    updates.stackProfile = {};
    updates.needsReconfiguration = false;
    updates.needsVerification = false;
    if (verifiedBranch) updates.defaultBranch = verifiedBranch;
    if (existing.graphBuiltAt != null) {
      updates.graphStatus = "stale";
      updates.graphError = null;
    }
    // The UI style profile describes the OLD repository's styling, which is a
    // different thing entirely once the URL changes — unlike the graph, which
    // is merely out of date. Queue a fresh read rather than keep it.
    if (existing.projectId != null) {
      await resetProfile(existing.projectId, existing.id);
    }
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
      const creds = await resolveGitCreds(req.userId);
      await GitService.forRepo(repo.id, {
        githubToken: creds.githubToken,
        azureReposToken: creds.azureReposToken,
      });
      // Self-heal: if the graph microservice is configured, kick a rebuild so the
      // graph refreshes against the new URL (triggerRepoIndex flips status
      // stale→indexing→succeeded on callback). Correctness does not depend on this
      // — retrieval already refuses the stale graph — so an unconfigured service
      // simply leaves it `stale` until a manual rebuild/upload.
      if (existing.graphBuiltAt != null && isGraphifyConfigured() && repo.url) {
        await triggerRepoIndex({
          repoUrl: repo.url,
          githubToken: creds.githubToken ?? "",
          repoId: repo.id,
          triggeredBy: req.userId,
          log: req.log,
        });
      }
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
    status: repo.graphStatus,
    error: repo.graphError,
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
      graphStatus: "succeeded",
      graphError: null,
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
  // Not scoped to the caller's own rows: re-indexing is an administrative
  // action on a project's repository, so it follows canAdminister like the
  // baseline scan does rather than owner-only. A team admin could already
  // spend real money scanning this repository while being refused a rebuild
  // that costs nothing, which was simply inconsistent.
  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(eq(repositoriesTable.id, params.data.repoId));
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  const [project] = repo.projectId
    ? await db.select().from(projectsTable).where(eq(projectsTable.id, repo.projectId))
    : [];
  const ownerUserId = project?.userId ?? repo.userId;
  const teamId = project?.teamId ?? null;
  if (
    !canAdminister(
      { userId: req.userId, teamId: req.teamId ?? null, teamRole: req.teamRole ?? null },
      { ownerUserId, teamId },
    )
  ) {
    // 404, not 403: a repository the caller may not administer and one that
    // does not exist must read the same, or the response confirms that a
    // repository id belongs to someone.
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
  // One index at a time. Without this, two clicks were two full clone-and-
  // extract jobs on the customer's repository. The claim goes stale after
  // INDEX_CLAIM_STALE_MINUTES so a lost callback cannot wedge the repository
  // (see services/graphUsability.ts).
  if (isIndexInFlight(repo.graphStatus, repo.graphStartedAt)) {
    res.status(409).json({
      status: "indexing",
      error: "This repository is already being indexed. Wait for it to finish, then rebuild again.",
    });
    return;
  }

  // The OWNER's credentials, not the caller's: an admin rebuilding someone
  // else's repository must not have their own token spent against it, and
  // resolveGitCreds derives the workspace from the id it is given.
  const cfg = await resolveGitCreds(ownerUserId);
  await triggerRepoIndex({
    repoUrl: repo.url,
    githubToken: cfg.githubToken ?? "",
    repoId: repo.id,
    triggeredBy: req.userId,
    log: req.log,
  });
  req.log.info({ repoId: repo.id }, "Graphify rebuild triggered");
  audit.log({
    userId: req.userId,
    teamId,
    action: "repository.reindex_started",
    entityType: "repository",
    entityId: repo.id,
    metadata: { name: repo.name, trigger: "manual" },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
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
