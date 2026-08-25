import { and, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db,
  runsTable,
  tasksTable,
  suggestionsTable,
  suggestionFilesTable,
  projectsTable,
  changePlansTable,
} from "@workspace/db";
import * as audit from "./auditService.js";
import { GitService } from "./gitService.js";
import { getRunRepository } from "./repoResolver.js";
import { loadSuggestionFiles } from "./suggestionFiles.js";
import { resolveCommitFiles, STALE_BRANCH_MESSAGE } from "./commitResolver.js";
import { AIOrchestrator, SynthesisEngine, type FileReader } from "./aiService.js";
import { checkCoherence, buildRepoSymbolIndex, type RepoSymbolIndex } from "./coherence/index.js";
import { isGraphServable, triggerRepoIndex } from "./graphifyService.js";
import {
  runPlanning,
  assemblePlanContext,
  recordContextTruncation,
  loadCurrentPlanRow,
  loadPlanFiles,
  createPlanRevision,
  type RevisionFileInput,
  type PlanningSummary,
} from "./planningService.js";
import { describeStack } from "./stackPromptBuilder.js";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";
import type { ChangePlan } from "../../../../shared/types/changePlan.js";
import type { CodeSuggestion } from "../../../../shared/types/codeSuggestion.js";
import type { DevCopilotTask } from "../../../../shared/types/task.js";
import { getConfigs } from "./configService.js";
import { sendRunCompleted, sendRunFailed, sendRunParked } from "./emailService.js";
import { confidenceReason } from "./confidence.js";
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

// Cap on how many unchanged sibling files the coherence checker reads for its
// repo context — a change is coherent with the code around it, and reading the
// whole repo per run would be both slow and unnecessary.
const COHERENCE_CONTEXT_CAP = 40;

/**
 * Build the coherence checker's repo context: the UNCHANGED .cs files that sit
 * in the same directories as a suggestion's changed .cs files (Phase 3). These
 * hold the sibling interfaces/services/DTOs a multi-file change must stay
 * coherent with. Bounded and best-effort — any read failure just yields a
 * smaller index (the checker skips what it cannot resolve, never guesses).
 */
async function buildCoherenceRepoContext(
  suggestions: CodeSuggestion[],
  git: { fetchFilePaths: () => Promise<string[]>; fetchFileWithSha: FileReader },
): Promise<RepoSymbolIndex> {
  const changed = new Set<string>();
  for (const s of suggestions) for (const f of s.files) changed.add(f.filePath);
  const changedCs = [...changed].filter((p) => p.endsWith(".cs"));
  if (changedCs.length === 0) return buildRepoSymbolIndex([]);

  const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
  const dirs = new Set(changedCs.map(dirOf));

  let tree: string[];
  try {
    tree = await git.fetchFilePaths();
  } catch {
    return buildRepoSymbolIndex([]);
  }
  const siblings = tree
    .filter((p) => p.endsWith(".cs") && !changed.has(p) && dirs.has(dirOf(p)))
    .slice(0, COHERENCE_CONTEXT_CAP);

  const read = await Promise.all(
    siblings.map(async (p) => {
      const f = await git.fetchFileWithSha(p).catch(() => null);
      return f ? { filePath: p, content: f.content } : null;
    }),
  );
  return buildRepoSymbolIndex(read.filter((f): f is { filePath: string; content: string } => f !== null));
}

/**
 * Run the static coherence checker over each valid multi-file suggestion and
 * attach the result to `s.coherence` (Phase 3). Mutates in place — the caller
 * has already filtered to valid suggestions, which are references into `raw`, so
 * the result rides through synthesis and persistence. Single-file / non-C# /
 * repo-context-less runs are clean passes handled inside checkCoherence.
 */
async function attachCoherence(
  suggestions: CodeSuggestion[],
  git: { fetchFilePaths: () => Promise<string[]>; fetchFileWithSha: FileReader },
): Promise<void> {
  if (suggestions.length === 0) return;
  const repoContext = await buildCoherenceRepoContext(suggestions, git);
  for (const s of suggestions) s.coherence = checkCoherence(s.files, repoContext);
}

/**
 * Run both agents (optionally against a change plan), rank the valid ones, and
 * persist every suggestion (invalid ones too, so the UI can show why) with its
 * change set. Shared by the initial run and the plan-revision regeneration.
 * New rows are non-superseded; the caller decides commit/all-invalid handling.
 */
async function generateAndPersistSuggestions(params: {
  runId: number;
  orchestrator: AIOrchestrator;
  synth: SynthesisEngine;
  devTask: DevCopilotTask;
  codeContext: string;
  stack: StackProfile;
  fileReader?: FileReader;
  planInput?: { plan: ChangePlan; context: string };
  coherenceGit?: { fetchFilePaths: () => Promise<string[]>; fetchFileWithSha: FileReader };
}): Promise<{
  raw: CodeSuggestion[];
  ranked: CodeSuggestion[];
  validRaw: CodeSuggestion[];
  inserted: (typeof suggestionsTable.$inferSelect)[];
}> {
  const { runId, orchestrator, synth, devTask, codeContext, stack, fileReader, planInput, coherenceGit } = params;

  const raw = await orchestrator.generateSuggestions(devTask, codeContext, stack, fileReader, planInput);

  // Only valid (cleanly-applied) suggestions reach Synthesia (1.4).
  const validRaw = raw.filter((s) => s.valid);
  // Static coherence check BEFORE ranking (Phase 3) — Synthesia folds it into
  // the weighted score and a failed check excludes a suggestion from being
  // Recommended. Best-effort: a checker/read failure leaves coherence unset,
  // which the scorer treats as neutral.
  if (coherenceGit) {
    try {
      await attachCoherence(validRaw, coherenceGit);
    } catch (err) {
      logger.warn({ runId, err }, "Coherence check failed — proceeding without it");
    }
  }
  const ranked =
    validRaw.length > 0
      ? await synth.synthesize(validRaw, stack, { title: devTask.title, acceptanceCriteria: devTask.acceptanceCriteria })
      : [];

  // Persist ALL suggestions, merging scores back onto the ranked/valid ones by
  // agent. Rows are index-aligned with `raw`.
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
            // Static coherence (Phase 3). numeric column → store the 0–1 score
            // as a string; findings mirror the shared CoherenceFinding shape.
            coherenceScore: sc?.coherence ? String(sc.coherence.score) : null,
            coherenceStatus: sc?.coherence?.status ?? null,
            coherenceFindings: sc?.coherence?.findings ?? null,
          };
        }),
      )
      .returning();

    // Persist each suggestion's change set (0022/0023/0024/0026).
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

  return { raw, ranked, validRaw, inserted };
}

/**
 * Execute a run end-to-end (spec §5.1). Shared by manual (inline) and scheduled
 * (dispatcher) paths. Everything is scoped to run.userId — the dispatcher has no
 * request user. Persists suggestions; optionally auto-commits the top one.
 * Never throws: failures are captured on the run row.
 */
export async function executeRun(runId: number, opts?: { reusePlan?: boolean }): Promise<void> {
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (!run) {
    logger.warn({ runId }, "executeRun: run not found");
    return;
  }
  if (run.status === "canceled" || run.status === "succeeded") return;

  const userId = run.userId;
  // Team scope for the plan audit entries + the project confidence threshold.
  const [proj] = run.projectId
    ? await db
        .select({ teamId: projectsTable.teamId, confidenceThreshold: projectsTable.confidenceThreshold })
        .from(projectsTable)
        .where(eq(projectsTable.id, run.projectId))
    : [];
  const teamId = proj?.teamId ?? null;
  const confidenceThreshold = proj?.confidenceThreshold != null ? Number(proj.confidenceThreshold) : 0.6;
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
      // Use the Graphify graph for precise, low-token context when one is loaded,
      // current, and its build succeeded (a stale graph — URL changed since the
      // build — is refused); otherwise fetchFileContextWithGraph falls back to
      // keywords.
      const graph =
        repo.graphJson && isGraphServable(repo.graphStatus, repo.graphBuiltAt)
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
    // Same GitService, reused by the coherence checker to read unchanged sibling
    // files for its repo context (Phase 3).
    let coherenceGit: { fetchFilePaths: () => Promise<string[]>; fetchFileWithSha: FileReader } | undefined;
    try {
      const gitRead = await GitService.forRepo(repo.id, {
        githubToken: creds.GITHUB_TOKEN,
        azureReposToken: creds.AZURE_REPOS_TOKEN,
      });
      fileReader = (path) => gitRead.fetchFileWithSha(path);
      coherenceGit = { fetchFilePaths: () => gitRead.fetchFilePaths(), fetchFileWithSha: (p) => gitRead.fetchFileWithSha(p) };
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
    let planSummary: PlanningSummary | undefined;
    if (opts?.reusePlan) {
      // Approve path (Phase 4): generate against the already-parked plan without
      // re-planning or re-gating — the human approved this exact plan. Mark it
      // back to `ready` for the record.
      const planRow = await loadCurrentPlanRow(runId);
      if (planRow && fileReader) {
        const planFiles = await loadPlanFiles(planRow.id);
        const plan: ChangePlan = {
          files: planFiles.map((f) => ({ op: f.op, path: f.filePath, rationale: f.rationale, symbols: f.symbols ?? undefined })),
          notes: planRow.notes ?? undefined,
        };
        const tree = coherenceGit ? await coherenceGit.fetchFilePaths() : [];
        const assembled = await assemblePlanContext(plan, fileReader, tree);
        planInput = { plan, context: assembled.context };
        await db.update(changePlansTable).set({ status: "ready" }).where(eq(changePlansTable.id, planRow.id));
      }
    } else if (creds.ANTHROPIC_API_KEY) {
      try {
        const gitPlan = await GitService.forRepo(repo.id, {
          githubToken: creds.GITHUB_TOKEN,
          azureReposToken: creds.AZURE_REPOS_TOKEN,
        });
        const tree = await gitPlan.fetchFilePaths();
        // Pass the RAW graph + its status/build time; runPlanning owns the
        // servability decision (isGraphServable) internally, so a stale graph
        // can never reach candidate retrieval even if a future caller forgets to
        // filter. A 'graph' retrievalMode therefore still means the graph is
        // current — the guarantee is structural, not this caller's convention.
        planSummary = await runPlanning({
          runId,
          projectId: run.projectId,
          userId,
          teamId,
          workItem: {
            title: workItem.title,
            description: effectiveDescription,
            acceptanceCriteria: devTask.acceptanceCriteria,
          },
          keywords,
          stack,
          tree,
          graph: repo.graphJson as unknown as GraphifyGraph | null,
          graphStatus: repo.graphStatus,
          graphBuiltAt: repo.graphBuiltAt,
          anthropicApiKey: creds.ANTHROPIC_API_KEY,
        });
        logger.info({ runId, ...planSummary, plan: undefined }, "Change plan produced");

        // Assemble the per-file generation context (full content for edits, a
        // convention sibling for creates) and hand the plan to both agents.
        if (planSummary.status === "ready" && planSummary.plan && planSummary.plan.files.length > 0 && fileReader) {
          const assembled = await assemblePlanContext(planSummary.plan, fileReader, tree);
          if (planSummary.planId && assembled.truncated.length > 0) {
            await recordContextTruncation(planSummary.planId, assembled.truncated).catch((err) =>
              logger.warn({ runId, err }, "Recording context truncation failed"),
            );
          }
          planInput = { plan: planSummary.plan, context: assembled.context };
        }
      } catch (e) {
        logger.warn({ runId, err: e }, "Run: change planning failed — proceeding without a plan");
      }
    }

    // Confidence gate (Phase 4): a freshly-planned `ready` plan whose confidence
    // is below the project threshold PARKS for human review — no generation.
    // Placed outside the planning try so a park-write error can't fall through
    // to generation. Runs with no `ready` plan (planning failed / no key) are
    // NOT gated — they fall to the Phase 1 single-file path (documented limit).
    // The approve path (reusePlan) skips the gate entirely.
    if (
      !opts?.reusePlan &&
      planSummary?.status === "ready" &&
      planSummary.confidenceScore != null &&
      planSummary.confidenceScore < confidenceThreshold
    ) {
      await db
        .update(changePlansTable)
        .set({ status: "awaiting_review" })
        .where(and(eq(changePlansTable.runId, runId), eq(changePlansTable.superseded, false)));
      await db
        .update(runsTable)
        .set({ status: "awaiting_review", usedGraphContext })
        .where(eq(runsTable.id, runId));
      logger.info(
        { runId, confidence: planSummary.confidenceScore, threshold: confidenceThreshold, weakest: planSummary.confidenceSignals?.weakestSignal },
        "Run parked awaiting review — confidence below threshold",
      );
      // A scheduled run is unattended, so notify the owner it parked (Phase 4
      // PR3). No auto-approval/retry — it waits for a human. Interactive runs
      // need no email: the user is already on the run page seeing the banner.
      if (run.trigger === "scheduled") {
        const email = await primaryEmail(userId);
        if (email) {
          await sendRunParked(email, {
            itemTitle: workItem.title,
            itemKey: workItem.externalId,
            runId,
            reason: planSummary.confidenceSignals ? confidenceReason(planSummary.confidenceSignals) : "Low confidence in the retrieved file set.",
            confidencePct: Math.round(planSummary.confidenceScore * 100),
          }).catch((e) => logger.warn({ runId, err: e }, "Run-parked email failed"));
        }
      }
      return;
    }

    const { raw, ranked, validRaw, inserted } = await generateAndPersistSuggestions({
      runId,
      orchestrator,
      synth,
      devTask,
      codeContext,
      stack,
      fileReader,
      planInput,
      coherenceGit,
    });

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
      // Only the Recommended suggestion is auto-committed. The coherence
      // exclusion rule guarantees a failed suggestion is never Recommended, so
      // when every suggestion failed the check there is no Recommended one and
      // auto-commit is skipped — even in a single-suggestion run (Phase 3). The
      // status re-check below is belt-and-suspenders on that guarantee.
      const top = ranked.find((s) => s.recommendation === "Recommended");
      // `inserted` is aligned with `raw`; find the persisted row for the chosen agent.
      const insertedIdx = top ? raw.findIndex((s) => s.agent === top.agent) : -1;
      if (top && top.coherence?.status !== "failed") {
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

// ---------------------------------------------------------------------------
// Confidence-gate exits (Phase 4). Edit-then-approve reuses reviseAndRegenerate.
// ---------------------------------------------------------------------------

/**
 * Approve a parked (awaiting_review) run: generate against the already-scored
 * plan exactly as a `ready` plan would, without re-planning or re-gating.
 * Validates state synchronously (throws RunError for the route), then runs
 * generation in the background (executeRun never throws).
 */
export async function approvePlan(runId: number, userId: string): Promise<void> {
  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, runId), eq(runsTable.userId, userId)));
  if (!run) throw new RunError("Run not found", 404);
  if (run.status !== "awaiting_review") throw new RunError("This run is not awaiting review.", 409);
  void executeRun(runId, { reusePlan: true }).catch((err) => logger.error({ runId, err }, "Approve-generation crashed"));
}

/**
 * Reject a parked run: it ends cleanly with NO suggestions and no partial state.
 * The run becomes `canceled` (a human declining a plan — distinct from `failed`,
 * a technical error). Nothing downstream (Aegis/Veria/Narratia/tests) runs, as
 * all guard on committedSuggestionId, which is never set.
 */
export async function rejectPlan(runId: number, userId: string): Promise<void> {
  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, runId), eq(runsTable.userId, userId)));
  if (!run) throw new RunError("Run not found", 404);
  if (run.status !== "awaiting_review") throw new RunError("This run is not awaiting review.", 409);
  await db.update(runsTable).set({ status: "canceled", finishedAt: new Date() }).where(eq(runsTable.id, runId));
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
  override?: boolean,
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
  // A suggestion that FAILED the coherence check can only be committed with an
  // explicit override (Phase 3) — the UI disables the commit button and asks the
  // user to confirm before sending override.
  if (sug.coherenceStatus === "failed" && !override) {
    throw new RunError(
      "This suggestion failed the coherence check. Review the findings, then confirm to commit anyway.",
      409,
    );
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

// ---------------------------------------------------------------------------
// Plan revision + regeneration (Phase 2 PR3, §3.2)
// ---------------------------------------------------------------------------

/**
 * Regenerate a run's suggestions against a (user-edited) plan, in the
 * background. Never throws — a failure lands on the run row. Does not
 * auto-commit; the user reviews and commits the new suggestions.
 */
async function regenerateFromPlan(
  run: typeof runsTable.$inferSelect,
  plan: ChangePlan,
  planId: number,
): Promise<void> {
  const runId = run.id;
  try {
    const [workItem] = await db.select().from(tasksTable).where(eq(tasksTable.id, run.workItemId));
    if (!workItem) throw new Error("Work item not found");
    const repo = await getRunRepository(run);
    if (!repo) throw new Error("No repository is connected to this run's project.");
    const stack = repo.stackProfile as StackProfile;
    const creds = await getConfigs(run.userId, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);

    const git = await GitService.forRepo(repo.id, {
      githubToken: creds.GITHUB_TOKEN,
      azureReposToken: creds.AZURE_REPOS_TOKEN,
    });
    const fileReader: FileReader = (p) => git.fetchFileWithSha(p);
    const tree = await git.fetchFilePaths();
    const assembled = await assemblePlanContext(plan, fileReader, tree);
    if (assembled.truncated.length > 0) {
      await recordContextTruncation(planId, assembled.truncated).catch((err) =>
        logger.warn({ runId, err }, "Recording context truncation failed"),
      );
    }

    const effectiveDescription = run.refinePrompt
      ? `${workItem.description ?? ""}\n\nRefinement request: ${run.refinePrompt}`
      : workItem.description;
    const devTask = dbTaskToDevCopilotTask({ ...workItem, description: effectiveDescription ?? null });
    const orchestrator = new AIOrchestrator({ anthropicApiKey: creds.ANTHROPIC_API_KEY, openaiApiKey: creds.OPENAI_API_KEY });
    const synth = new SynthesisEngine({ anthropicApiKey: creds.ANTHROPIC_API_KEY });

    const { raw, validRaw } = await generateAndPersistSuggestions({
      runId,
      orchestrator,
      synth,
      devTask,
      codeContext: assembled.context,
      stack,
      fileReader,
      planInput: { plan, context: assembled.context },
      coherenceGit: { fetchFilePaths: () => git.fetchFilePaths(), fetchFileWithSha: (p) => git.fetchFileWithSha(p) },
    });

    if (raw.length > 0 && validRaw.length === 0) {
      const reasons = raw
        .flatMap((s) => s.files.filter((f) => f.applyStatus === "failed").map((f) => f.applyError))
        .filter(Boolean)
        .join("\n\n");
      await db
        .update(runsTable)
        .set({ status: "failed", finishedAt: new Date(), error: `No suggestion could be applied to the repository.\n\n${reasons}` })
        .where(eq(runsTable.id, runId));
      return;
    }
    await db.update(runsTable).set({ status: "succeeded", finishedAt: new Date() }).where(eq(runsTable.id, runId));
  } catch (err) {
    logger.error({ runId, err }, "Plan regeneration failed");
    await db
      .update(runsTable)
      .set({ status: "failed", finishedAt: new Date(), error: err instanceof Error ? err.message : "Regeneration failed" })
      .where(eq(runsTable.id, runId));
  }
}

/**
 * Apply a user's plan edits (§3.2): write a new plan revision, supersede the
 * prior revision's suggestions (retained, not deleted), and regenerate in the
 * background. Returns immediately with the new revision. Owner-only; refuses a
 * run that has already been committed.
 */
export async function reviseAndRegenerate(
  runId: number,
  userId: string,
  files: RevisionFileInput[],
  auditCtx?: { teamId: number | null; ipAddress?: string },
): Promise<{ planId: number; revision: number }> {
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, runId));
  if (!run) throw new RunError("Run not found", 404);
  if (run.userId !== userId) throw new RunError("Access denied.", 403);
  if (run.committedSuggestionId != null) {
    throw new RunError("This run has already been committed — its plan can't be edited.", 409);
  }

  const prior = await loadCurrentPlanRow(runId);
  if (!prior) throw new RunError("This run has no plan to edit.", 409);
  const priorFiles = await loadPlanFiles(prior.id);

  const { planId, revision, plan } = await createPlanRevision(prior, files);

  // Supersede the current suggestions (retained for the prior revision).
  await db
    .update(suggestionsTable)
    .set({ superseded: true })
    .where(and(eq(suggestionsTable.runId, runId), eq(suggestionsTable.superseded, false)));

  // Show the regeneration in the UI, then run it in the background.
  await db.update(runsTable).set({ status: "running", error: null, startedAt: new Date() }).where(eq(runsTable.id, runId));
  void regenerateFromPlan(run, plan, planId).catch((err) => logger.error({ runId, err }, "Plan regeneration crashed"));

  // Audit the edit as the diff between revisions (§4.1). Fire-and-forget.
  // in_candidates distinguishes a retrieval miss (false) from a planner miss
  // (true) for a user-added file — sourced from the ORIGINAL retrieval set.
  const teamId = auditCtx?.teamId ?? null;
  const ipAddress = auditCtx?.ipAddress;
  const candidatePaths = new Set((prior.candidateFiles ?? []).map((c) => c.path));
  const newPaths = new Set(files.map((f) => f.path));
  const priorPaths = new Set(priorFiles.map((f) => f.filePath));
  for (const f of priorFiles.filter((f) => !newPaths.has(f.filePath))) {
    audit.log({
      userId,
      teamId,
      ipAddress,
      action: "plan.file_removed",
      entityType: "change_plan",
      entityId: planId,
      metadata: { runId, revision, filePath: f.filePath, op: f.op, inCandidates: f.inCandidates },
    });
  }
  for (const f of files.filter((f) => !priorPaths.has(f.path))) {
    audit.log({
      userId,
      teamId,
      ipAddress,
      action: "plan.file_added",
      entityType: "change_plan",
      entityId: planId,
      metadata: { runId, revision, filePath: f.path, op: f.op, addedSource: f.addedSource ?? "manual", inCandidates: candidatePaths.has(f.path) },
    });
  }
  audit.log({
    userId,
    teamId,
    ipAddress,
    action: "plan.edited",
    entityType: "change_plan",
    entityId: planId,
    metadata: { runId, revision, priorRevision: prior.revision, fileCount: files.length },
  });
  audit.log({
    userId,
    teamId,
    ipAddress,
    action: "plan.regenerated",
    entityType: "change_plan",
    entityId: planId,
    metadata: { runId, revision },
  });

  return { planId, revision };
}
