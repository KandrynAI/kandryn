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
import { isGraphUsable } from "../services/graphifyService.js";

const router: IRouter = Router();

const RepoIdParam = z.object({ repoId: z.coerce.number().int().positive() });

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

  const [repo] = await db
    .insert(repositoriesTable)
    .values({
      ...(parsed.data as typeof repositoriesTable.$inferInsert),
      userId: req.userId,
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
  const graphifyUrl = process.env.GRAPHIFY_SERVICE_URL;
  if (graphifyUrl) {
    const cfg = await getConfigs(req.userId, ["GITHUB_TOKEN"]);
    const callbackUrl = `${process.env.APP_BASE_URL ?? "https://getbluemantis.com"}/api/internal/graphify-callback`;
    void fetch(`${graphifyUrl}/index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-secret": process.env.GRAPHIFY_SERVICE_SECRET ?? "",
      },
      body: JSON.stringify({
        repo_url: updated.url,
        github_token: cfg.GITHUB_TOKEN ?? "",
        repo_id: updated.id,
        callback_url: callbackUrl,
      }),
    }).catch((err) => req.log.warn({ err }, "Graphify index trigger failed"));
  }

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
  const [repo] = await db
    .update(repositoriesTable)
    .set(parsed.data as Partial<typeof repositoriesTable.$inferInsert>)
    .where(
      and(eq(repositoriesTable.id, params.data.id), eq(repositoriesTable.userId, req.userId)),
    )
    .returning();
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }
  res.json(UpdateRepositoryResponse.parse(repo));
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
  res.sendStatus(204);
});

export default router;
