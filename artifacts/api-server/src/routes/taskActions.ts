import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, tasksTable, repositoriesTable } from "@workspace/db";
import { GitService } from "../services/gitService.js";
import { AIOrchestrator, SynthesisEngine } from "../services/aiService.js";
import { PLMService } from "../services/plmService.js";
import { getConfigs } from "../services/configService.js";
import type { StackProfile } from "../stack/detector.js";
import type { DevCopilotTask } from "../../../../shared/types/task.js";
import { PR_TITLE_PREFIX } from "../../../../shared/types/branding.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Inline Zod schemas for action endpoints
// ---------------------------------------------------------------------------

const TaskIdParams = z.object({
  taskId: z.coerce.number().int().positive(),
});

const SuggestionsBody = z.object({
  refinePrompt: z.string().optional(),
});

const CommitBody = z.object({
  filePath: z.string().min(1),
  code: z.string().min(1),
  commitMessage: z.string().min(1),
});

const CompleteBody = z.object({
  commitHash: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "in", "on", "at", "for", "of", "to", "is", "are",
  "was", "be", "and", "or", "with", "from", "by", "as", "it", "this",
  "that", "api", "the", "not", "add", "new", "via",
]);

export function extractKeywords(title: string, description?: string | null): string[] {
  const text = [title, description].filter(Boolean).join(" ");
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[\s\-_/.,;:!?()[\]{}]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
        .slice(0, 12),
    ),
  ];
}

export function dbTaskToDevCopilotTask(task: typeof tasksTable.$inferSelect): DevCopilotTask {
  const sourceMap: Record<string, DevCopilotTask["source"]> = {
    "azure-devops": "azure-devops",
    jira: "jira",
  };
  const typeMap: Record<string, DevCopilotTask["type"]> = {
    feature: "feature",
    bug: "bug",
    story: "story",
    chore: "task",
    epic: "epic",
    task: "task",
  };
  const priorityMap: Record<string, DevCopilotTask["priority"]> = {
    critical: 1,
    high: 2,
    medium: 3,
    low: 4,
  };

  return {
    id: task.externalId ?? String(task.id),
    source: sourceMap[task.source] ?? "azure-devops",
    type: typeMap[task.type] ?? "task",
    title: task.title,
    description: task.description ?? "",
    acceptanceCriteria: task.acceptanceCriteria
      ? task.acceptanceCriteria.split(/\n|;/).map((s) => s.trim()).filter(Boolean)
      : [],
    priority: priorityMap[task.priority] ?? 3,
    rawSource: {},
  };
}

// ---------------------------------------------------------------------------
// POST /tasks/:taskId/suggestions
// ---------------------------------------------------------------------------

router.post("/tasks/:taskId/suggestions", async (req, res): Promise<void> => {
  const params = TaskIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SuggestionsBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const userId = req.userId;

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.taskId), eq(tasksTable.userId, userId)));

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (!task.repositoryId) {
    res.status(422).json({ error: "Task has no linked repository — cannot fetch file context" });
    return;
  }

  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(and(eq(repositoriesTable.id, task.repositoryId), eq(repositoriesTable.userId, userId)));

  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  // Fetch user's AI credentials from DB
  const userCreds = await getConfigs(userId, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);

  const stack = repo.stackProfile as StackProfile;
  const refinePrompt = body.data.refinePrompt;
  const effectiveDescription = refinePrompt
    ? `${task.description ?? ""}\n\nRefinement request: ${refinePrompt}`
    : task.description;
  const keywords = extractKeywords(task.title, effectiveDescription);

  req.log.info({ taskId: task.id, repoId: repo.id, keywords, refine: !!refinePrompt }, "Generating AI suggestions");

  const gitCreds = await getConfigs(userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);

  let codeContext = "";
  let fileReader: ((path: string) => Promise<{ content: string; sha: string } | null>) | undefined;
  try {
    const gitService = await GitService.forRepo(repo.id, {
      githubToken: gitCreds.GITHUB_TOKEN,
      azureReposToken: gitCreds.AZURE_REPOS_TOKEN,
    });
    codeContext = await gitService.fetchFileContext(String(task.id), keywords, stack);
    // Reader so edit hunks resolve against current source (Phase 1).
    fileReader = (path) => gitService.fetchFileWithSha(path);
  } catch (gitErr) {
    req.log.warn({ taskId: task.id, err: gitErr }, "Git file context unavailable — proceeding without it");
  }

  // Instantiate per-request orchestrator with user's credentials
  const aiOrchestrator = new AIOrchestrator({
    anthropicApiKey: userCreds.ANTHROPIC_API_KEY,
    openaiApiKey: userCreds.OPENAI_API_KEY,
  });
  const synthesisEngine = new SynthesisEngine({
    anthropicApiKey: userCreds.ANTHROPIC_API_KEY,
  });

  const devCopilotTask = dbTaskToDevCopilotTask({
    ...task,
    description: effectiveDescription ?? null,
  });
  const suggestions = await aiOrchestrator.generateSuggestions(devCopilotTask, codeContext, stack, fileReader);
  const ranked = await synthesisEngine.synthesize(
    suggestions.filter((s) => s.valid),
    stack,
  );

  req.log.info({ taskId: task.id, count: ranked.length }, "Suggestions generated");
  res.json(ranked);
});

// ---------------------------------------------------------------------------
// POST /tasks/:taskId/commit
// ---------------------------------------------------------------------------

router.post("/tasks/:taskId/commit", async (req, res): Promise<void> => {
  const params = TaskIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CommitBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.taskId), eq(tasksTable.userId, req.userId)));

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (!task.repositoryId) {
    res.status(422).json({ error: "Task has no linked repository" });
    return;
  }

  // Verify the repository belongs to this user (prevent IDOR via repositoryId)
  const [commitRepo] = await db
    .select()
    .from(repositoriesTable)
    .where(and(eq(repositoriesTable.id, task.repositoryId), eq(repositoriesTable.userId, req.userId)));

  if (!commitRepo) {
    res.status(403).json({ error: "Repository access denied" });
    return;
  }

  const gitCredsCommit = await getConfigs(req.userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
  const gitService = await GitService.forRepo(task.repositoryId, {
    githubToken: gitCredsCommit.GITHUB_TOKEN,
    azureReposToken: gitCredsCommit.AZURE_REPOS_TOKEN,
  });
  const branchName = `task/${task.id}`;

  await gitService.createBranch(String(task.id));

  const commitHash = await gitService.commitChanges({
    branchName,
    message: body.data.commitMessage,
    files: [{ path: body.data.filePath, content: body.data.code }],
  });

  const prUrl = await gitService.createPullRequest({
    title: `${PR_TITLE_PREFIX} ${task.title}`,
    body: `Auto-generated by Kandryn for task #${task.id}.\n\nCommit: ${commitHash}`,
    head: branchName,
    base: gitService.defaultBranch,
  });

  await db
    .update(tasksTable)
    .set({ linkedCommit: commitHash, status: "review" })
    .where(eq(tasksTable.id, task.id));

  req.log.info({ taskId: task.id, commitHash, prUrl }, "Task committed and PR opened");
  res.json({ commitHash, prUrl });
});

// ---------------------------------------------------------------------------
// POST /tasks/:taskId/complete
// ---------------------------------------------------------------------------

router.post("/tasks/:taskId/complete", async (req, res): Promise<void> => {
  const params = TaskIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CompleteBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.taskId), eq(tasksTable.userId, req.userId)));

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if ((task.source === "azure-devops" || task.source === "jira") && task.externalId) {
    const userId = req.userId;
    const userCreds = await getConfigs(userId, [
      "AZURE_DEVOPS_ORG",
      "AZURE_DEVOPS_PROJECT",
      "AZURE_DEVOPS_PAT",
      "JIRA_DOMAIN",
      "JIRA_EMAIL",
      "JIRA_API_TOKEN",
    ]);
    const plmSvc = new PLMService({
      azureOrg: userCreds.AZURE_DEVOPS_ORG,
      azureProject: userCreds.AZURE_DEVOPS_PROJECT,
      azurePat: userCreds.AZURE_DEVOPS_PAT,
      jiraDomain: userCreds.JIRA_DOMAIN,
      jiraEmail: userCreds.JIRA_EMAIL,
      jiraToken: userCreds.JIRA_API_TOKEN,
    });
    await plmSvc.closeTask(
      task.source as "azure-devops" | "jira",
      task.externalId,
      body.data.commitHash,
    );
  }

  await db
    .update(tasksTable)
    .set({ status: "done", linkedCommit: body.data.commitHash })
    .where(eq(tasksTable.id, task.id));

  req.log.info({ taskId: task.id, source: task.source }, "Task marked complete");
  res.json({ success: true });
});

export default router;
