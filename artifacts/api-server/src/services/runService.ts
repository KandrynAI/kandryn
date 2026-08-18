import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  runsTable,
  tasksTable,
  suggestionsTable,
  suggestionFilesTable,
} from "@workspace/db";
import { GitService } from "./gitService.js";
import { getRunRepository } from "./repoResolver.js";
import { loadSuggestionFiles } from "./suggestionFiles.js";
import { resolveCommitFiles, STALE_BRANCH_MESSAGE } from "./commitResolver.js";
import { AIOrchestrator, SynthesisEngine, type FileReader } from "./aiService.js";
import { isGraphUsable, triggerRepoIndex } from "./graphifyService.js";
import { runPlanning, assemblePlanContext, recordContextTruncation } from "./planningService.js";
import { describeStack } from "./stackPromptBuilder.js";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";
import type { ChangePlan } from "../../../../shared/types/changePlan.js";
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
    // Resolve the repo from the run's snapshot (runs.repository_id), falling back
    // to the project's binding via repositories.project_id (0020) — never the
    // deprecated projects.repository_id.
    const repo = await getRunRepository(run);
    if (!repo) throw new Error("No repository is connected to this run's project.");
    if (!repo.url) throw new Error("Repository needs reconfiguration — no URL is set. Set a valid repository URL and try again.");

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

    // Reader so the orchestrator can apply edit hunks against current source
    // (Phase 1). Best-effort — a missing reader just makes edits fail to resolve.
    let fileReader: FileReader | undefined;
    try {
      const gitRead = await GitService.forRepo(repo.id, {
        githubToken: creds.GITHUB_TOKEN,
        azureReposToken: creds.AZURE_REPOS_TOKEN,
      });
      fileReader = (path) => gitRead.fetchFileWithSha(path);
    } catch (e) {
      logger.warn({ runId, err: e }, "Run: file reader unavailable — edits cannot be resolved");
    }

    const orchestrator = new AIOrchestrator({
      anthropicApiKey: creds.ANTHROPIC_API_KEY,
      openaiApiKey: creds.OPENAI_API_KEY,
    });
    const synth = new SynthesisEngine({ anthropicApiKey: creds.ANTHROPIC_API_KEY });
    const devTask = dbTaskToDevCopilotTask({ ...workItem, description: effectiveDescription ?? null });

    // Change plan (Phase 2): plan which files the change touches before
    // generation, then feed the plan + per-file context to BOTH agents so they
    // implement the same plan (§2.1). Tree-primary — the graph only enhances
    // candidate quality when fresh, and its absence is not an error. Best-effort
    // and non-blocking: planning never fails the run; on any failure generation
    // falls back to the Phase 1 single-file path. Needs the Anthropic key (the
    // run would fail at generation without it anyway).
    let planInput: { plan: ChangePlan; context: string } | undefined;
    if (creds.ANTHROPIC_API_KEY) {
      try {
        const gitPlan = await GitService.forRepo(repo.id, {
          githubToken: creds.GITHUB_TOKEN,
          azureReposToken: creds.AZURE_REPOS_TOKEN,
        });
        const tree = await gitPlan.fetchFilePaths();
        const graph =
          repo.graphJson && isGraphUsable(repo.graphBuiltAt)
            ? (repo.graphJson as unknown as GraphifyGraph)
            : null;
        const plan = await runPlanning({
          runId,
          workItem: {
            title: workItem.title,
            description: effectiveDescription,
            acceptanceCriteria: devTask.acceptanceCriteria,
          },
          keywords,
          stack,
          tree,
          graph,
          graphBuiltAt: repo.graphBuiltAt ?? null,
          anthropicApiKey: creds.ANTHROPIC_API_KEY,
        });
        logger.info({ runId, ...plan, plan: undefined }, "Change plan produced");

        // Assemble the per-file generation context (full content for edits, a
        // convention sibling for creates) and hand the plan to both agents.
        if (plan.status === "ready" && plan.plan && plan.plan.files.length > 0 && fileReader) {
          const assembled = await assemblePlanContext(plan.plan, fileReader, tree);
          if (plan.planId && assembled.truncated.length > 0) {
            await recordContextTruncation(plan.planId, assembled.truncated).catch((err) =>
              logger.warn({ runId, err }, "Recording context truncation failed"),
            );
          }
          planInput = { plan: plan.plan, context: assembled.context };
        }
      } catch (e) {
        logger.warn({ runId, err: e }, "Run: change planning failed — proceeding without a plan");
      }
    }

    const raw = await orchestrator.generateSuggestions(devTask, codeContext, stack, fileReader, planInput);

    // Only valid (cleanly-applied) suggestions reach Synthesia (1.4).
    const validRaw = raw.filter((s) => s.valid);
    const ranked =
      validRaw.length > 0
        ? await synth.synthesize(validRaw, stack, {
            title: devTask.title,
            acceptanceCriteria: devTask.acceptanceCriteria,
          })
        : [];

    // Persist ALL suggestions (invalid ones too, so the UI can show why they
    // failed), merging scores back onto the ranked/valid ones by agent. Rows are
    // index-aligned with `raw`.
    const scoreByAgent = new Map(ranked.map((r) => [r.agent, r]));
    let inserted: (typeof suggestionsTable.$inferSelect)[] = [];
    if (raw.length > 0) {
      inserted = await db
        .insert(suggestionsTable)
        .values(
          raw.map((s) => {
            const sc = scoreByAgent.get(s.agent);
            return {
              runId,
              agent: s.agent,
              explanation: s.explanation,
              language: s.language,
              score: sc?.score != null ? Math.round(sc.score) : null,
              recommendation: sc?.recommendation ?? null,
              scoreBreakdown: sc?.scoreBreakdown ?? null,
              scoreNarrative: sc?.scoreNarrative ?? null,
            };
          }),
        )
        .returning();

      // Persist each suggestion's change set (0022/0023).
      const fileRows = inserted.flatMap((row, i) =>
        (raw[i]?.files ?? []).map((f) => ({
          suggestionId: row.id,
          seq: f.seq,
          op: f.op,
          filePath: f.filePath,
          content: f.content,
          hunks: (f.hunks ?? null) as typeof suggestionFilesTable.$inferInsert.hunks,
          sourceBlobSha: f.sourceBlobSha ?? null,
          diff: (f.diff ?? null) as typeof suggestionFilesTable.$inferInsert.diff,
          resolved: f.resolved,
          applyStatus: f.applyStatus,
          applyError: f.applyError ?? null,
          deviationReason: f.deviationReason ?? null,
          linesAdded: f.linesAdded,
          linesRemoved: f.linesRemoved,
        })),
      );
      if (fileRows.length > 0) await db.insert(suggestionFilesTable).values(fileRows);
    }

    // Both agents produced changes that could not be applied — fail the run with
    // the specific reasons rather than committing anything (1.4).
    if (raw.length > 0 && validRaw.length === 0) {
      const reasons = raw
        .flatMap((s) => s.files.filter((f) => f.applyStatus === "failed").map((f) => f.applyError))
        .filter(Boolean)
        .join("\n\n");
      throw new Error(`No suggestion could be applied to the repository.\n\n${reasons}`);
    }

    let prUrl: string | null = null;
    let commitHash: string | null = null;
    let committedSuggestionId: number | null = null;
    if (run.autoCommit && ranked.length > 0) {
      const top = ranked.find((s) => s.recommendation === "Recommended") ?? ranked[0];
      // `inserted` is aligned with `raw`; find the persisted row for the chosen agent.
      const insertedIdx = raw.findIndex((s) => s.agent === top.agent);
      if (top) {
        const git = await GitService.forRepo(repo.id, {
          githubToken: creds.GITHUB_TOKEN,
          azureReposToken: creds.AZURE_REPOS_TOKEN,
        });
        // Re-check staleness against the current branch before committing (1.5).
        const resolved = await resolveCommitFiles(top.files, (p) => git.fetchFileWithSha(p));
        if (!resolved.ok) {
          throw new Error(
            `${STALE_BRANCH_MESSAGE} ${resolved.path} moved (${resolved.reason}). Re-run to regenerate against the latest code.`,
          );
        }
        const branchName = `task/${workItem.id}`;
        await git.createBranch(String(workItem.id));
        commitHash = await git.commitChanges({
          branchName,
          message: `Blue Mantis: ${workItem.title}`,
          files: resolved.files,
        });
        prUrl = await git.createPullRequest({
          title: `[Blue Mantis] ${workItem.title}`,
          body: `Auto-generated by Blue Mantis (run #${runId}).\n\nCommit: ${commitHash}`,
          head: branchName,
          base: git.defaultBranch,
        });
        committedSuggestionId = inserted[insertedIdx]?.id ?? null;
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
  // The change set lives in suggestion_files (0022), not sug.code/file_path.
  const sugFiles = await loadSuggestionFiles(sug.id);
  if (sugFiles.length === 0) throw new RunError("Suggestion has no files to commit.", 422);
  // An invalid suggestion (an edit that didn't apply) can never be committed (1.4).
  if (sugFiles.some((f) => f.applyStatus === "failed")) {
    throw new RunError("This suggestion could not be applied to the repository and cannot be committed.", 409);
  }

  const [workItem] = await db.select().from(tasksTable).where(eq(tasksTable.id, run.workItemId));
  if (!workItem) throw new RunError("Work item not found", 404);
  // Resolve via the run's repository snapshot (0020), not projects.repository_id,
  // so the commit lands in the same repo the code was generated against.
  const repo = await getRunRepository(run);
  if (!repo) throw new RunError("No repository is connected to this run's project.", 422);
  if (!repo.url) throw new RunError("Repository needs reconfiguration — set a valid repository URL and try again.", 400);

  const creds = await getConfigs(userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
  const git = await GitService.forRepo(repo.id, {
    githubToken: creds.GITHUB_TOKEN,
    azureReposToken: creds.AZURE_REPOS_TOKEN,
  });
  // Re-check staleness against the current branch before committing (1.5).
  const resolved = await resolveCommitFiles(sugFiles, (p) => git.fetchFileWithSha(p));
  if (!resolved.ok) {
    throw new RunError(
      `${STALE_BRANCH_MESSAGE} ${resolved.path} moved (${resolved.reason}). Re-run to regenerate against the latest code.`,
      409,
    );
  }
  const branchName = `task/${workItem.id}`;
  await git.createBranch(String(workItem.id));
  const commitHash = await git.commitChanges({
    branchName,
    message: commitMessage ?? `Blue Mantis: ${workItem.title}`,
    files: resolved.files,
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
