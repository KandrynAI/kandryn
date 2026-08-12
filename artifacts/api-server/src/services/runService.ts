import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  runsTable,
  tasksTable,
  projectsTable,
  repositoriesTable,
  suggestionsTable,
} from "@workspace/db";
import { GitService } from "./gitService.js";
import { AIOrchestrator, SynthesisEngine } from "./aiService.js";
import { isGraphUsable, triggerRepoIndex } from "./graphifyService.js";
import { describeStack } from "./stackPromptBuilder.js";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";
import { getConfigs } from "./configService.js";
import { sendRunCompleted, sendRunFailed } from "./emailService.js";
import { extractKeywords, dbTaskToDevCopilotTask } from "../routes/taskActions.js";
import type { StackProfile } from "../stack/detector.js";
import { logger } from "../lib/logger.js";

export class RunError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "RunError";
  }
}

async function primaryEmail(userId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  } catch {
    return null;
  }
}

/**
 * Execute a run end-to-end (spec §5.1). Shared by manual (inline) and scheduled
 * (dispatcher) paths. Everything is scoped to run.userId — the dispatcher has no
 * request user. Persists suggestions; optionally auto-commits the top one.
 * Never throws: failures are captured on the run row.
 */
export async function executeRun(runId: number): Promise<void> {
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (!run) {
    logger.warn({ runId }, "executeRun: run not found");
    return;
  }
  if (run.status === "canceled" || run.status === "succeeded") return;

  const userId = run.userId;
  await db.update(runsTable).set({ status: "running", startedAt: new Date() }).where(eq(runsTable.id, runId));

  try {
    const [workItem] = await db.select().from(tasksTable).where(eq(tasksTable.id, run.workItemId));
    if (!workItem) throw new Error("Work item not found");
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, run.projectId));
    if (!project) throw new Error("Project not found");
    const [repo] = await db
      .select()
      .from(repositoriesTable)
      .where(eq(repositoriesTable.id, project.repositoryId));
    if (!repo) throw new Error("Repository not found");

    const stack = repo.stackProfile as StackProfile;
    // Record the stack this run targets (surfaced in the run info strip) and log
    // it. Persisted early so even a later failure shows which stack was used.
    const stackDesc = describeStack(stack);
    logger.info({ runId, workItemId: workItem.id, stackDesc }, "Running agents with stack-aware prompt");
    await db.update(runsTable).set({ stackDesc }).where(eq(runsTable.id, runId));

    const creds = await getConfigs(userId, [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GITHUB_TOKEN",
      "AZURE_REPOS_TOKEN",
    ]);

    const effectiveDescription = run.refinePrompt
      ? `${workItem.description ?? ""}\n\nRefinement request: ${run.refinePrompt}`
      : workItem.description;
    const keywords = extractKeywords(workItem.title, effectiveDescription);

    let codeContext = "";
    let usedGraphContext = false;
    try {
      const git = await GitService.forRepo(repo.id, {
        githubToken: creds.GITHUB_TOKEN,
        azureReposToken: creds.AZURE_REPOS_TOKEN,
      });
      // Use the Graphify graph for precise, low-token context when one is loaded
      // and fresh; otherwise fetchFileContextWithGraph falls back to keywords.
      const graph =
        repo.graphJson && isGraphUsable(repo.graphBuiltAt)
          ? (repo.graphJson as unknown as GraphifyGraph)
          : null;
      const ctx = await git.fetchFileContextWithGraph(String(workItem.id), keywords, stack, graph);
      codeContext = ctx.context;
      usedGraphContext = ctx.usedGraph;
    } catch (e) {
      logger.warn({ runId, err: e }, "Run: git file context unavailable — proceeding without it");
    }

    const orchestrator = new AIOrchestrator({
      anthropicApiKey: creds.ANTHROPIC_API_KEY,
      openaiApiKey: creds.OPENAI_API_KEY,
    });
    const synth = new SynthesisEngine({ anthropicApiKey: creds.ANTHROPIC_API_KEY });
    const devTask = dbTaskToDevCopilotTask({ ...workItem, description: effectiveDescription ?? null });
    const raw = await orchestrator.generateSuggestions(devTask, codeContext, stack);
    const ranked = await synth.synthesize(raw, stack, {
      title: devTask.title,
      acceptanceCriteria: devTask.acceptanceCriteria,
    });

    // Persist suggestions and keep the inserted rows so we can record which one
    // gets committed (index-aligned with `ranked`).
    let inserted: (typeof suggestionsTable.$inferSelect)[] = [];
    if (ranked.length > 0) {
      inserted = await db
        .insert(suggestionsTable)
        .values(
          ranked.map((s) => ({
            runId,
            agent: s.agent,
            code: s.code,
            explanation: s.explanation,
            filePath: s.filePath,
            language: s.language,
            score: s.score != null ? Math.round(s.score) : null,
            recommendation: s.recommendation ?? null,
            scoreBreakdown: s.scoreBreakdown ?? null,
            scoreNarrative: s.scoreNarrative ?? null,
          })),
        )
        .returning();
    }

    let prUrl: string | null = null;
    let commitHash: string | null = null;
    let committedSuggestionId: number | null = null;
    if (run.autoCommit) {
      const topIndex = ranked.findIndex((s) => s.recommendation === "Recommended");
      const idx = topIndex >= 0 ? topIndex : ranked.length > 0 ? 0 : -1;
      const top = idx >= 0 ? ranked[idx] : undefined;
      if (top) {
        const git = await GitService.forRepo(repo.id, {
          githubToken: creds.GITHUB_TOKEN,
          azureReposToken: creds.AZURE_REPOS_TOKEN,
        });
        const branchName = `task/${workItem.id}`;
        await git.createBranch(String(workItem.id));
        commitHash = await git.commitChanges({
          branchName,
          message: `Blue Mantis: ${workItem.title}`,
          files: [{ path: top.filePath, content: top.code }],
        });
        prUrl = await git.createPullRequest({
          title: `[Blue Mantis] ${workItem.title}`,
          body: `Auto-generated by Blue Mantis (run #${runId}).\n\nCommit: ${commitHash}`,
          head: branchName,
          base: git.defaultBranch,
        });
        committedSuggestionId = inserted[idx]?.id ?? null;
        await db.update(tasksTable).set({ status: "review", linkedCommit: commitHash }).where(eq(tasksTable.id, workItem.id));
        // The repo changed — schedule a Graphify re-index so future runs use a
        // fresh graph (Phase 3). Fire-and-forget; no-op if unconfigured.
        triggerRepoIndex({ repoUrl: repo.url, githubToken: creds.GITHUB_TOKEN ?? "", repoId: repo.id, log: logger });
      }
    }

    await db
      .update(runsTable)
      .set({ status: "succeeded", finishedAt: new Date(), prUrl, commitHash, committedSuggestionId, usedGraphContext })
      .where(eq(runsTable.id, runId));

    if (run.trigger === "scheduled") {
      const email = await primaryEmail(userId);
      if (email) {
        await sendRunCompleted(email, {
          itemTitle: workItem.title,
          itemKey: workItem.externalId,
          runId,
          agentCount: ranked.length,
          topScore: ranked[0]?.score ?? null,
          prUrl,
        }).catch((e) => logger.warn({ runId, err: e }, "Run-completed email failed"));
      }
    }
  } catch (err) {
    // Drizzle wraps the driver error and its message is just "Failed query: …";
    // append the underlying cause (e.g. the pg message) so the run error is
    // actually diagnosable in the UI.
    const base = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause instanceof Error ? ` — ${err.cause.message}` : "";
    const msg = `${base}${cause}`.slice(0, 1000);
    logger.error({ runId, err }, "Run failed");
    await db.update(runsTable).set({ status: "failed", finishedAt: new Date(), error: msg }).where(eq(runsTable.id, runId));
    if (run.trigger === "scheduled") {
      const [wi] = await db.select({ title: tasksTable.title }).from(tasksTable).where(eq(tasksTable.id, run.workItemId));
      const email = await primaryEmail(run.userId);
      if (email) {
        await sendRunFailed(email, { itemTitle: wi?.title ?? "work item", runId, error: msg }).catch((e) =>
          logger.warn({ runId, err: e }, "Run-failed email failed"),
        );
      }
    }
  }
}

/**
 * Commit a persisted suggestion (spec §3.3 POST /runs/:id/commit). Creates a
 * branch, commits the suggestion, opens a PR, moves the work item to review.
 */
export async function commitFromSuggestion(
  userId: string,
  runId: number,
  suggestionId: number,
  commitMessage?: string,
): Promise<{ commitHash: string; prUrl: string }> {
  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, runId), eq(runsTable.userId, userId)));
  if (!run) throw new RunError("Run not found", 404);

  const [sug] = await db
    .select()
    .from(suggestionsTable)
    .where(and(eq(suggestionsTable.id, suggestionId), eq(suggestionsTable.runId, runId)));
  if (!sug) throw new RunError("Suggestion not found", 404);

  const [workItem] = await db.select().from(tasksTable).where(eq(tasksTable.id, run.workItemId));
  if (!workItem) throw new RunError("Work item not found", 404);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, run.projectId));
  if (!project) throw new RunError("Project not found", 404);
  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(and(eq(repositoriesTable.id, project.repositoryId), eq(repositoriesTable.userId, userId)));
  if (!repo) throw new RunError("Repository access denied", 403);

  const creds = await getConfigs(userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
  const git = await GitService.forRepo(repo.id, {
    githubToken: creds.GITHUB_TOKEN,
    azureReposToken: creds.AZURE_REPOS_TOKEN,
  });
  const branchName = `task/${workItem.id}`;
  await git.createBranch(String(workItem.id));
  const commitHash = await git.commitChanges({
    branchName,
    message: commitMessage ?? `Blue Mantis: ${workItem.title}`,
    files: [{ path: sug.filePath, content: sug.code }],
  });
  const prUrl = await git.createPullRequest({
    title: `[Blue Mantis] ${workItem.title}`,
    body: `Blue Mantis suggestion (run #${runId}).\n\nCommit: ${commitHash}`,
    head: branchName,
    base: git.defaultBranch,
  });

  await db.update(tasksTable).set({ status: "review", linkedCommit: commitHash }).where(eq(tasksTable.id, workItem.id));
  await db
    .update(runsTable)
    .set({ prUrl, commitHash, committedSuggestionId: sug.id })
    .where(eq(runsTable.id, runId));
  // The repo changed — schedule a Graphify re-index (Phase 3). Fire-and-forget.
  triggerRepoIndex({ repoUrl: repo.url, githubToken: creds.GITHUB_TOKEN ?? "", repoId: repo.id, log: logger });
  return { commitHash, prUrl };
}
