import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, runsTable, tasksTable, suggestionsTable, projectsTable } from "@workspace/db";
import { z } from "zod/v4";
import { executeRun, commitFromSuggestion, reviseAndRegenerate, RunError } from "../services/runService.js";
import { loadRunPlanDTO } from "../services/planningService.js";
import { GitService } from "../services/gitService.js";
import { getConfigs } from "../services/configService.js";
import { runVeriaReview } from "../services/veriaService.js";
import { runAegisScan } from "../services/aegisService.js";
import {
  createAegisPlmTicket,
  ensureFindingTask,
  buildRemediationPrompt,
  getAegisIssueTypePref,
  resolveIssueType,
} from "../services/aegisPlmService.js";
import { postSecurityStatus } from "../services/gitService.js";
import { getProjectRepository, getRunRepository } from "../services/repoResolver.js";
import { suggestionPrimaryFile, loadFilesForSuggestions, loadSuggestionFiles } from "../services/suggestionFiles.js";
import { syncProject } from "../services/syncService.js";
import type { PlmProvider } from "../services/plmWrite.js";
import type { AegisScanResult } from "../../../../shared/types/aegisResult.js";
import { runNarratia } from "../services/narratiaService.js";
import { pushAsMarkdown, pushToConfluence, pushToNotion } from "../services/narratiaPushService.js";
import type { RunbookTarget } from "../../../../shared/types/narratiaResult.js";
import * as audit from "../services/auditService.js";

const router: IRouter = Router();

const IdParam = z.object({ id: z.coerce.number().int().positive() });
const WorkItemIdParam = z.object({ id: z.coerce.number().int().positive() });

const MAX_SCHEDULE_DAYS = 30;
const MAX_PENDING_SCHEDULED = 20;

const CreateRunBody = z.object({
  refinePrompt: z.string().max(2000).optional(),
  autoCommit: z.boolean().optional().default(false),
  // ISO-8601 UTC instant; only present for scheduled runs.
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});

const CommitRunBody = z.object({
  suggestionId: z.coerce.number().int().positive(),
  commitMessage: z.string().min(1).max(500).optional(),
});

const ListRunsQuery = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  workItemId: z.coerce.number().int().positive().optional(),
  status: z
    .enum(["scheduled", "queued", "running", "succeeded", "failed", "canceled"])
    .optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
  trigger: z.string().optional(), // filters runs.trigger_context (e.g. "remediation")
  parentRunId: z.coerce.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// POST /work-items/:id/runs — create a run (inline or scheduled)
// ---------------------------------------------------------------------------
// No scheduledAt → run inline in this request, respond with the completed run
// + suggestions. With scheduledAt → persist a scheduled run, respond 202 with
// the run id; the cron dispatcher picks it up when due (spec §3.3).
router.post("/work-items/:id/runs", async (req, res): Promise<void> => {
  const params = WorkItemIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid work item id" });
    return;
  }
  const parsed = CreateRunBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
    return;
  }

  const [workItem] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.userId, req.userId)));
  if (!workItem) {
    res.status(404).json({ error: "Work item not found" });
    return;
  }
  if (workItem.projectId == null) {
    res.status(422).json({ error: "Work item is not attached to a project — cannot run." });
    return;
  }

  // Snapshot the project's repository onto the run so execution and commit act on
  // one fixed repo (0020). A project with no repo can't run.
  const runRepo = await getProjectRepository(workItem.projectId, req.userId);
  if (!runRepo) {
    res.status(400).json({ error: "No repository is connected to this project. Connect one on the board first." });
    return;
  }

  const { refinePrompt, autoCommit, scheduledAt } = parsed.data;

  // --- Scheduled path -------------------------------------------------------
  if (scheduledAt) {
    const when = new Date(scheduledAt);
    const now = Date.now();
    if (when.getTime() <= now) {
      res.status(422).json({ error: "scheduledAt must be in the future." });
      return;
    }
    if (when.getTime() > now + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) {
      res.status(422).json({ error: `scheduledAt cannot be more than ${MAX_SCHEDULE_DAYS} days out.` });
      return;
    }

    const [{ pending }] = await db
      .select({ pending: sql<number>`count(*)::int` })
      .from(runsTable)
      .where(and(eq(runsTable.userId, req.userId), inArray(runsTable.status, ["scheduled", "queued"])));
    if (pending >= MAX_PENDING_SCHEDULED) {
      res.status(429).json({ error: `You already have ${MAX_PENDING_SCHEDULED} pending runs. Wait for some to finish.` });
      return;
    }

    const [run] = await db
      .insert(runsTable)
      .values({
        userId: req.userId,
        projectId: workItem.projectId,
        workItemId: workItem.id,
        repositoryId: runRepo.id,
        status: "scheduled",
        trigger: "scheduled",
        refinePrompt: refinePrompt ?? null,
        autoCommit,
        scheduledAt: when,
        runByUserId: req.userId,
      })
      .returning();
    req.log.info({ runId: run.id, workItemId: workItem.id, scheduledAt }, "Run scheduled");
    audit.log({
      userId: req.userId,
      teamId: req.teamId ?? null,
      action: "run.scheduled",
      entityType: "run",
      entityId: run.id,
      metadata: {
        workItemId: workItem.id,
        trigger: "manual",
        scheduledAt: when.toISOString(),
        hasRefinePrompt: Boolean(refinePrompt),
      },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.status(202).json(run);
    return;
  }

  // --- Inline path ----------------------------------------------------------
  const [run] = await db
    .insert(runsTable)
    .values({
      userId: req.userId,
      projectId: workItem.projectId,
      workItemId: workItem.id,
      repositoryId: runRepo.id,
      status: "queued",
      trigger: "manual",
      refinePrompt: refinePrompt ?? null,
      autoCommit,
      runByUserId: req.userId,
    })
    .returning();

  req.log.info({ runId: run.id, workItemId: workItem.id, autoCommit }, "Run started inline");
  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "run.triggered",
    entityType: "run",
    entityId: run.id,
    metadata: {
      workItemId: workItem.id,
      trigger: "manual",
      scheduledAt: null,
      hasRefinePrompt: Boolean(refinePrompt),
    },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  await executeRun(run.id);

  const [finished] = await db.select().from(runsTable).where(eq(runsTable.id, run.id));
  const suggestions = await db
    .select()
    .from(suggestionsTable)
    .where(eq(suggestionsTable.runId, run.id))
    .orderBy(desc(suggestionsTable.score));
  const inlineFiles = await loadFilesForSuggestions(suggestions.map((s) => s.id));
  res.status(201).json({
    run: finished,
    suggestions: suggestions.map((s) => ({ ...s, files: inlineFiles[s.id] ?? [] })),
  });
});

// ---------------------------------------------------------------------------
// GET /runs — list runs (optionally filtered by project / status)
// ---------------------------------------------------------------------------
router.get("/runs", async (req, res): Promise<void> => {
  const query = ListRunsQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.issues[0]?.message ?? "Invalid query" });
    return;
  }
  const conds = [eq(runsTable.userId, req.userId)];
  if (query.data.projectId != null) conds.push(eq(runsTable.projectId, query.data.projectId));
  if (query.data.workItemId != null) conds.push(eq(runsTable.workItemId, query.data.workItemId));
  if (query.data.status) conds.push(eq(runsTable.status, query.data.status));
  if (query.data.trigger) conds.push(eq(runsTable.triggerContext, query.data.trigger));
  if (query.data.parentRunId != null) conds.push(eq(runsTable.parentRunId, query.data.parentRunId));

  // An explicit ?limit wins (capped at 50 by the schema); otherwise a per-item
  // lookup wants a short recent history and the broad list keeps 200.
  const limit = query.data.limit ?? (query.data.workItemId != null ? 10 : 200);
  const runs = await db
    .select()
    .from(runsTable)
    .where(and(...conds))
    .orderBy(desc(runsTable.createdAt))
    .limit(limit);
  res.json(runs);
});

// ---------------------------------------------------------------------------
// GET /runs/:id — a run with its suggestions
// ---------------------------------------------------------------------------
router.get("/runs/:id", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, params.data.id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  // Owner sees their own run; any team member sees runs on a team project (0017).
  if (run.userId !== req.userId) {
    const [project] = run.projectId
      ? await db.select({ teamId: projectsTable.teamId }).from(projectsTable).where(eq(projectsTable.id, run.projectId))
      : [undefined];
    const isTeamProject = req.teamId != null && project?.teamId === req.teamId;
    if (!isTeamProject) {
      res.status(403).json({ error: "Access denied." });
      return;
    }
  }
  // Only the current revision's suggestions (superseded ones from an earlier
  // plan revision are retained but not shown — Phase 2 PR3).
  const suggestions = await db
    .select()
    .from(suggestionsTable)
    .where(and(eq(suggestionsTable.runId, run.id), eq(suggestionsTable.superseded, false)))
    .orderBy(desc(suggestionsTable.score));

  // Minimal work-item summary so the client can gate PLM actions (e.g. pushing
  // test cases) on the item's real PLM-link state instead of assuming it.
  const [workItem] = await db
    .select({ externalId: tasksTable.externalId, source: tasksTable.source })
    .from(tasksTable)
    .where(eq(tasksTable.id, run.workItemId));

  const detailFiles = await loadFilesForSuggestions(suggestions.map((s) => s.id));
  const plan = await loadRunPlanDTO(run.id);
  res.json({
    run,
    suggestions: suggestions.map((s) => ({ ...s, files: detailFiles[s.id] ?? [] })),
    workItem: workItem ?? null,
    plan,
  });
});

// ---------------------------------------------------------------------------
// GET /runs/:id/tree — repository path list, for plan-edit autocomplete (§3.2)
// ---------------------------------------------------------------------------
router.get("/runs/:id/tree", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const [run] = await db.select().from(runsTable).where(eq(runsTable.id, params.data.id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (run.userId !== req.userId) {
    res.status(403).json({ error: "Access denied." });
    return;
  }
  const repo = await getRunRepository(run);
  if (!repo?.url) {
    res.json({ paths: [] });
    return;
  }
  const creds = await getConfigs(run.userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
  const git = await GitService.forRepo(repo.id, { githubToken: creds.GITHUB_TOKEN, azureReposToken: creds.AZURE_REPOS_TOKEN });
  const paths = await git.fetchFilePaths();
  res.json({ paths });
});

// ---------------------------------------------------------------------------
// POST /runs/:id/plan/revise — apply plan edits → new revision → regenerate (§3.2)
// ---------------------------------------------------------------------------
const RevisePlanBody = z.object({
  files: z
    .array(
      z.object({
        op: z.enum(["create", "edit", "delete"]),
        path: z.string().min(1),
        rationale: z.string().min(1),
        symbols: z.array(z.string()).optional(),
        addedByUser: z.boolean().optional(),
        addedSource: z.enum(["autocomplete", "manual"]).optional(),
      }),
    )
    .min(1),
});
router.post("/runs/:id/plan/revise", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const body = RevisePlanBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A plan needs at least one file, each with a path and rationale." });
    return;
  }
  try {
    const result = await reviseAndRegenerate(params.data.id, req.userId!, body.data.files, {
      teamId: req.teamId ?? null,
      ipAddress: audit.getIp(req),
    });
    res.status(202).json(result);
  } catch (err) {
    if (err instanceof RunError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /runs/:id/cancel — cancel a scheduled/queued run
// ---------------------------------------------------------------------------
// Only pending runs can be canceled; a running/finished run is left as-is.
router.post("/runs/:id/cancel", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, params.data.id), eq(runsTable.userId, req.userId)));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (run.status !== "scheduled" && run.status !== "queued") {
    res.status(409).json({ error: `A ${run.status} run cannot be canceled.` });
    return;
  }
  const [updated] = await db
    .update(runsTable)
    .set({ status: "canceled", finishedAt: new Date() })
    .where(and(eq(runsTable.id, run.id), inArray(runsTable.status, ["scheduled", "queued"])))
    .returning();
  if (!updated) {
    // Lost the race to the dispatcher — it's already running.
    res.status(409).json({ error: "Run is already in progress." });
    return;
  }
  req.log.info({ runId: run.id }, "Run canceled");
  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "run.canceled",
    entityType: "run",
    entityId: run.id,
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// POST /runs/:id/commit — commit a persisted suggestion from this run
// ---------------------------------------------------------------------------
router.post("/runs/:id/commit", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const parsed = CommitRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
    return;
  }

  // Enforce a single commit per run. (Commit is signalled by
  // committedSuggestionId — this codebase has no dedicated "committed" status;
  // a committed run stays "succeeded".)
  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, params.data.id), eq(runsTable.userId, req.userId)));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (run.committedSuggestionId !== null) {
    res.status(409).json({
      error: "This run has already been committed.",
      committedSuggestionId: run.committedSuggestionId,
      prUrl: run.prUrl ?? null,
    });
    return;
  }

  try {
    const result = await commitFromSuggestion(
      req.userId,
      params.data.id,
      parsed.data.suggestionId,
      parsed.data.commitMessage,
    );
    req.log.info({ runId: params.data.id, ...result }, "Run suggestion committed");
    const [committedSuggestion] = await db
      .select({ agent: suggestionsTable.agent, score: suggestionsTable.score })
      .from(suggestionsTable)
      .where(eq(suggestionsTable.id, parsed.data.suggestionId));
    const committedPrimary = await suggestionPrimaryFile(parsed.data.suggestionId);
    audit.log({
      userId: req.userId,
      teamId: req.teamId ?? null,
      action: "run.committed",
      entityType: "run",
      entityId: params.data.id,
      metadata: {
        agent: committedSuggestion?.agent,
        score: committedSuggestion?.score,
        filePath: committedPrimary?.filePath ?? null,
        prUrl: result.prUrl,
      },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.json(result);
  } catch (err) {
    if (err instanceof RunError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /runs/:id/review — Veria reviews the committed code against the AC.
// A committed run is signalled by committedSuggestionId (there is no dedicated
// "committed" status; the run stays "succeeded").
// ---------------------------------------------------------------------------
router.post("/runs/:id/review", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const runId = params.data.id;

  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, runId), eq(runsTable.userId, req.userId)));
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }

  if (run.committedSuggestionId == null) {
    res.status(409).json({ error: "Veria requires a committed run. Commit a suggestion first." });
    return;
  }
  if (run.reviewStatus === "done" && run.review) {
    res.status(200).json({ review: run.review });
    return;
  }
  if (run.reviewStatus === "running") {
    res.status(202).json({ message: "Veria is already running on this run." });
    return;
  }

  // Mark running before the AI call (prevents double-dispatch).
  await db.update(runsTable).set({ reviewStatus: "running" }).where(eq(runsTable.id, runId));

  const [suggestion] = await db
    .select()
    .from(suggestionsTable)
    .where(eq(suggestionsTable.id, run.committedSuggestionId));
  if (!suggestion) {
    await db.update(runsTable).set({ reviewStatus: "failed" }).where(eq(runsTable.id, runId));
    res.status(404).json({ error: "Committed suggestion record not found." });
    return;
  }

  const [workItem] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, run.workItemId), eq(tasksTable.userId, req.userId)));

  // acceptance_criteria is a single newline-separated text column → string[].
  const acceptanceCriteria = workItem?.acceptanceCriteria
    ? workItem.acceptanceCriteria.split(/\n/).map((s) => s.trim()).filter(Boolean)
    : [];

  const creds = await getConfigs(req.userId, ["ANTHROPIC_API_KEY"]);
  if (!creds.ANTHROPIC_API_KEY) {
    await db.update(runsTable).set({ reviewStatus: "failed" }).where(eq(runsTable.id, runId));
    res.status(424).json({ error: "Add your Anthropic API key in Integrations to run Veria." });
    return;
  }

  // Veria judges the whole committed change set in one context so it can catch
  // cross-file incoherence (interface/impl/caller/DTO disagreement).
  const veriaFiles = (await loadSuggestionFiles(suggestion.id)).map((f) => ({
    filePath: f.filePath,
    op: f.op,
    code: f.content,
  }));
  try {
    const review = await runVeriaReview(
      {
        itemTitle: workItem?.title ?? "Untitled work item",
        itemType: workItem?.itemType ?? workItem?.type ?? "task",
        acceptanceCriteria,
        suggestionAgent: suggestion.agent,
        files: veriaFiles,
      },
      { anthropicApiKey: creds.ANTHROPIC_API_KEY },
    );

    await db.update(runsTable).set({ review, reviewStatus: "done" }).where(eq(runsTable.id, runId));
    req.log.info({ runId }, "Veria review completed");
    res.status(200).json({ review });
  } catch (err) {
    req.log.error({ err }, "Veria review failed");
    await db.update(runsTable).set({ reviewStatus: "failed" }).where(eq(runsTable.id, runId));
    res.status(502).json({ error: "Veria could not complete the review. Try again." });
  }
});

// ---------------------------------------------------------------------------
// POST /runs/:id/security — Aegis scans the committed code for vulnerabilities,
// files PLM tickets for High/Critical findings, posts a GitHub commit status
// check, and records the stop-gate decision. A committed run is signalled by
// committedSuggestionId (no dedicated "committed" status). Mirrors the Veria
// route's guard/lifecycle.
// ---------------------------------------------------------------------------
router.post("/runs/:id/security", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const runId = params.data.id;

  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, runId), eq(runsTable.userId, req.userId)));
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  if (run.committedSuggestionId == null) {
    res.status(409).json({ error: "Aegis requires a committed run. Commit a suggestion first." });
    return;
  }
  if (run.securityScanStatus === "done" && run.securityScan) {
    res.status(200).json({ scan: run.securityScan });
    return;
  }
  if (run.securityScanStatus === "running") {
    res.status(202).json({ message: "Aegis is already scanning." });
    return;
  }

  // Mark running before the AI call (prevents double-dispatch).
  await db
    .update(runsTable)
    .set({ securityScanStatus: "running", securityGate: "pending" })
    .where(eq(runsTable.id, runId));

  const [suggestion] = await db
    .select()
    .from(suggestionsTable)
    .where(eq(suggestionsTable.id, run.committedSuggestionId));
  if (!suggestion) {
    await db.update(runsTable).set({ securityScanStatus: "failed" }).where(eq(runsTable.id, runId));
    res.status(404).json({ error: "Committed suggestion record not found." });
    return;
  }

  const [workItem] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, run.workItemId), eq(tasksTable.userId, req.userId)));
  const acceptanceCriteria = workItem?.acceptanceCriteria
    ? workItem.acceptanceCriteria.split(/\n/).map((s) => s.trim()).filter(Boolean)
    : [];

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, run.projectId), eq(projectsTable.userId, req.userId)));
  // Resolve the run's repo via the snapshot / project_id (0020), not the
  // deprecated projects.repository_id.
  const repo = await getRunRepository(run);

  const creds = await getConfigs(req.userId, ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"]);
  if (!creds.ANTHROPIC_API_KEY) {
    await db.update(runsTable).set({ securityScanStatus: "failed", securityGate: null }).where(eq(runsTable.id, runId));
    res.status(424).json({ error: "Add your Anthropic API key in Integrations to run Aegis." });
    return;
  }

  // Every changed file is scanned independently (fail-closed gate). Deletions
  // have no content to scan and are excluded from coverage.
  const scanFiles = (await loadSuggestionFiles(suggestion.id))
    .filter((f) => f.op !== "delete" && f.content)
    .map((f) => ({ filePath: f.filePath, code: f.content }));
  try {
    const scan = await runAegisScan(
      {
        itemTitle: workItem?.title ?? "Untitled work item",
        itemType: workItem?.itemType ?? workItem?.type ?? "task",
        acceptanceCriteria,
        files: scanFiles,
        stackDesc: run.stackDesc ?? undefined,
      },
      { anthropicApiKey: creds.ANTHROPIC_API_KEY },
    );

    // File PLM tickets for High/Critical findings (best-effort; never fatal).
    const canFilePlm =
      workItem?.externalId &&
      (project?.plmProvider === "jira" || project?.plmProvider === "azure-devops") &&
      project.plmProjectKey;
    if (canFilePlm && workItem && project) {
      const issueTypePref = await getAegisIssueTypePref(req.userId, project.teamId);
      for (const finding of scan.findings) {
        if (finding.severity !== "critical" && finding.severity !== "high") continue;
        const ticket = await createAegisPlmTicket({
          finding,
          parentExternalId: workItem.externalId as string,
          parentTitle: workItem.title,
          plmProvider: project.plmProvider as PlmProvider,
          plmProjectKey: project.plmProjectKey,
          userId: req.userId,
          projectId: project.id,
          repositoryId: repo?.id ?? null,
          parentTaskId: workItem.id,
          issueType: resolveIssueType(issueTypePref, finding.severity),
          teamId: project.teamId,
        });
        if (ticket) {
          finding.plmTicketUrl = ticket.ticketUrl;
          finding.plmTicketKey = ticket.ticketKey;
        }
      }
    }

    await db
      .update(runsTable)
      .set({ securityScan: scan, securityScanStatus: "done", securityGate: scan.gateDecision })
      .where(eq(runsTable.id, runId));

    // Post the GitHub commit status check (the stop-gate signal). An unscanned
    // file blocks and its paths go in the check output — never a silent pass.
    if (repo && repo.url && run.commitHash) {
      const unscannedNames = scan.unscannedFiles.map((p) => p.split("/").pop()).join(", ");
      const gateDesc =
        scan.gateDecision === "blocked"
          ? scan.unscannedFiles.length > 0
            ? `Blocked: could not scan ${scan.unscannedFiles.length}/${scan.filesTotal} file(s): ${unscannedNames}`
            : `Blocked: ${scan.highCount} high, ${scan.criticalCount} critical across ${scan.filesScanned} file(s)`
          : `Approved: ${scan.filesScanned}/${scan.filesTotal} file(s) scanned, ${scan.findings.length} finding(s)`;
      await postSecurityStatus(repo.url, run.commitHash, scan.gateDecision, gateDesc, creds.GITHUB_TOKEN);
    }

    req.log.info(
      { runId, gate: scan.gateDecision, findings: scan.findings.length, filesScanned: scan.filesScanned, filesTotal: scan.filesTotal, unscanned: scan.unscannedFiles.length },
      "Aegis scan completed",
    );
    // Coverage is auditable after the fact: filesScanned/filesTotal prove the
    // control ran on every changed file, not just asserted in the moment.
    audit.log({
      userId: req.userId,
      teamId: req.teamId ?? null,
      action: "aegis.scan_run",
      entityType: "run",
      entityId: run.id,
      metadata: {
        gateDecision: scan.gateDecision,
        criticalCount: scan.criticalCount,
        highCount: scan.highCount,
        filesScanned: scan.filesScanned,
        filesTotal: scan.filesTotal,
        unscannedFiles: scan.unscannedFiles,
      },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.status(200).json({ scan });
  } catch (err) {
    req.log.error({ err }, "Aegis scan failed");
    await db.update(runsTable).set({ securityScanStatus: "failed", securityGate: null }).where(eq(runsTable.id, runId));
    res.status(502).json({ error: "Aegis could not complete the scan. Try again." });
  }
});

// ---------------------------------------------------------------------------
// POST /runs/:id/runbook — Narratia generates an operational runbook from the
// committed run and pushes it to the chosen target (markdown → PR branch /
// confluence / notion). Committed run signalled by committedSuggestionId.
// ---------------------------------------------------------------------------
const RunbookBody = z.object({
  target: z.enum(["markdown", "confluence", "notion"]).default("markdown"),
});

router.post("/runs/:id/runbook", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const parsedBody = RunbookBody.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({ error: "target must be markdown, confluence, or notion" });
    return;
  }
  const runId = params.data.id;
  const target: RunbookTarget = parsedBody.data.target;

  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, runId), eq(runsTable.userId, req.userId)));
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  if (run.committedSuggestionId == null) {
    res.status(409).json({ error: "Narratia requires a committed run." });
    return;
  }
  if (run.runbookStatus === "done" && run.runbook && run.runbookTarget === target) {
    res.status(200).json({ runbook: run.runbook, url: run.runbookUrl, target });
    return;
  }
  if (run.runbookStatus === "running") {
    res.status(202).json({ message: "Narratia is already generating." });
    return;
  }

  await db.update(runsTable).set({ runbookStatus: "running", runbookTarget: target }).where(eq(runsTable.id, runId));

  const [suggestion] = await db
    .select()
    .from(suggestionsTable)
    .where(eq(suggestionsTable.id, run.committedSuggestionId));
  if (!suggestion) {
    await db.update(runsTable).set({ runbookStatus: "failed" }).where(eq(runsTable.id, runId));
    res.status(404).json({ error: "Committed suggestion record not found." });
    return;
  }

  const [workItem] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, run.workItemId), eq(tasksTable.userId, req.userId)));
  const acceptanceCriteria = workItem?.acceptanceCriteria
    ? workItem.acceptanceCriteria.split(/\n/).map((s) => s.trim()).filter(Boolean)
    : [];

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, run.projectId), eq(projectsTable.userId, req.userId)));
  // Resolve the run's repo via the snapshot / project_id (0020), not the
  // deprecated projects.repository_id.
  const repo = await getRunRepository(run);

  const creds = await getConfigs(req.userId, ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
  if (!creds.ANTHROPIC_API_KEY) {
    await db.update(runsTable).set({ runbookStatus: "failed" }).where(eq(runsTable.id, runId));
    res.status(424).json({ error: "Add your Anthropic API key in Integrations to run Narratia." });
    return;
  }

  // Enrichment from the other agents.
  const veriaFindings: string[] = [];
  run.review?.findings?.forEach((f) => {
    if (f.type === "gap" || f.type === "risk") veriaFindings.push(`${f.type.toUpperCase()}: ${f.title} — ${f.detail}`);
  });
  const aegisFindings: string[] =
    run.securityScan?.findings?.map((f) => `${f.severity.toUpperCase()} (${f.owasp}): ${f.title}${f.plmTicketKey ? ` → ${f.plmTicketKey}` : ""}`) ?? [];
  const testCases = (suggestion.testCases ?? []).map((t) => ({
    title: t.title,
    given: t.given,
    when: t.when,
    then: t.then,
    assertion: t.assertion,
  }));

  const itemKey = workItem?.externalId ?? `RUN-${runId}`;
  const branchName = `task/${run.workItemId}`;

  // The runbook documents the whole committed change set, not just one file.
  const narratiaFiles = (await loadSuggestionFiles(suggestion.id)).map((f) => ({
    filePath: f.filePath,
    op: f.op,
    code: f.content,
  }));
  try {
    const result = await runNarratia(
      {
        itemKey,
        itemTitle: workItem?.title ?? "Untitled work item",
        itemType: workItem?.itemType ?? workItem?.type ?? "task",
        itemDescription: workItem?.description ?? undefined,
        acceptanceCriteria,
        files: narratiaFiles,
        stackDesc: run.stackDesc ?? undefined,
        branchName,
        prUrl: run.prUrl ?? undefined,
        commitHash: run.commitHash ?? undefined,
        veriaFindings: veriaFindings.length ? veriaFindings : undefined,
        aegisFindings: aegisFindings.length ? aegisFindings : undefined,
        aegisGate: run.securityScan?.gateDecision ?? undefined,
        testCases: testCases.length ? testCases : undefined,
        target,
      },
      { anthropicApiKey: creds.ANTHROPIC_API_KEY },
    );

    let pushedUrl: string | null = null;
    if (target === "markdown" && repo && repo.url) {
      const push = await pushAsMarkdown({
        markdown: result.markdown,
        filePath: `docs/runbooks/${itemKey.toLowerCase()}.md`,
        branchName,
        repoId: repo.id,
        repoUrl: repo.url,
        creds: { githubToken: creds.GITHUB_TOKEN, azureReposToken: creds.AZURE_REPOS_TOKEN },
      });
      pushedUrl = push?.url ?? null;
    } else if (target === "confluence") {
      pushedUrl = (await pushToConfluence(req.userId, result))?.url ?? null;
    } else if (target === "notion") {
      pushedUrl = (await pushToNotion(req.userId, result))?.url ?? null;
    }

    await db
      .update(runsTable)
      .set({ runbook: result.markdown, runbookStatus: "done", runbookTarget: target, runbookUrl: pushedUrl })
      .where(eq(runsTable.id, runId));

    req.log.info({ runId, target, pushed: pushedUrl != null }, "Narratia runbook generated");
    audit.log({
      userId: req.userId,
      teamId: req.teamId ?? null,
      action: "narratia.runbook_generated",
      entityType: "run",
      entityId: run.id,
      metadata: { target, pushedUrl },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.status(200).json({ runbook: result.markdown, url: pushedUrl, target, sections: result.sections.map((s) => s.title) });
  } catch (err) {
    req.log.error({ err }, "Narratia generation failed");
    await db.update(runsTable).set({ runbookStatus: "failed" }).where(eq(runsTable.id, runId));
    res.status(502).json({ error: "Narratia could not generate the runbook. Try again." });
  }
});

// ---------------------------------------------------------------------------
// POST /runs/:id/security/remediate — close the Aegis loop for one finding.
// action 'push': file the PLM ticket (if not already) + mirror a board task +
// sync. action 'remediate-now': the same, then start a remediation run (Raptia
// + Fovea) on the new task with a fix-only refinement prompt.
// ---------------------------------------------------------------------------
const RemediateBody = z.object({
  findingId: z.string().min(1),
  action: z.enum(["push", "remediate-now"]),
  // Optional per-finding override; falls back to the team preference.
  issueType: z.enum(["bug", "subtask"]).optional(),
});

router.post("/runs/:id/security/remediate", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid run id" });
    return;
  }
  const parsed = RemediateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "findingId and action are required." });
    return;
  }
  const runId = params.data.id;
  const { findingId, action } = parsed.data;

  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, runId), eq(runsTable.userId, req.userId)));
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  if (!run.securityScan) {
    res.status(409).json({ error: "No security scan found on this run." });
    return;
  }
  const scan = run.securityScan as AegisScanResult;
  const finding = scan.findings.find((f) => f.id === findingId);
  if (!finding) {
    res.status(404).json({ error: `Finding ${findingId} not found.` });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, run.projectId), eq(projectsTable.userId, req.userId)));
  if (!project) {
    res.status(409).json({ error: "No project found for this run." });
    return;
  }
  // The run's repository via snapshot / project_id (0020).
  const repo = await getRunRepository(run);
  if (project.plmProvider !== "jira" && project.plmProvider !== "azure-devops") {
    res.status(409).json({ error: "This project's tracker doesn't support ticket creation." });
    return;
  }
  const [workItem] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, run.workItemId), eq(tasksTable.userId, req.userId)));

  // STEP A: ensure a PLM ticket + mirrored board task exist for this finding.
  let ticketKey: string;
  let ticketUrl: string | undefined;
  let internalTaskId: number;
  try {
    if (finding.plmTicketKey) {
      // Filed already (during the scan, for high/critical). Reuse it; just make
      // sure the board task exists so we can run against it.
      ticketKey = finding.plmTicketKey;
      ticketUrl = finding.plmTicketUrl;
      internalTaskId = await ensureFindingTask({
        userId: req.userId,
        projectId: project.id,
        repositoryId: repo?.id ?? null,
        parentTaskId: workItem?.id ?? null,
        finding,
        ticketKey,
        ticketUrl: ticketUrl ?? "",
        plmProvider: project.plmProvider as PlmProvider,
      });
    } else {
      // Remediate Now is always a standalone Bug; a plain push honours the
      // per-finding override, else the team preference (smart by default).
      const issueType: "bug" | "subtask" =
        action === "remediate-now"
          ? "bug"
          : parsed.data.issueType ??
            resolveIssueType(await getAegisIssueTypePref(req.userId, project.teamId), finding.severity);
      const ticket = await createAegisPlmTicket({
        finding,
        parentExternalId: workItem?.externalId ?? "",
        parentTitle: workItem?.title ?? "",
        plmProvider: project.plmProvider as PlmProvider,
        plmProjectKey: project.plmProjectKey,
        userId: req.userId,
        projectId: project.id,
        repositoryId: repo?.id ?? null,
        parentTaskId: workItem?.id ?? null,
        issueType,
        teamId: project.teamId,
      });
      if (!ticket) {
        res.status(502).json({ error: "Could not create PLM ticket. Check your tracker credentials." });
        return;
      }
      ticketKey = ticket.ticketKey;
      ticketUrl = ticket.ticketUrl;
      internalTaskId = ticket.internalTaskId;
    }
  } catch (err) {
    req.log.error({ err, findingId }, "Failed to create PLM ticket for finding");
    res.status(502).json({ error: "Could not create PLM ticket. Check your tracker credentials." });
    return;
  }

  // Reflect the ticket on the stored scan finding.
  const mark = (patch: Partial<typeof finding>) => {
    const updated = scan.findings.map((f) => (f.id === findingId ? { ...f, ...patch } : f));
    return { ...scan, findings: updated };
  };
  let updatedScan = mark({ plmTicketKey: ticketKey, plmTicketUrl: ticketUrl, pushedToBoard: true });
  await db.update(runsTable).set({ securityScan: updatedScan }).where(eq(runsTable.id, runId));

  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "aegis.finding_pushed",
    entityType: "run",
    entityId: runId,
    metadata: { findingId, ticketKey, severity: finding.severity, internalTaskId },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });

  // STEP B: sync the board so the new ticket appears (non-fatal).
  try {
    await syncProject(req.userId, project.id);
  } catch (syncErr) {
    req.log.warn({ syncErr }, "Board sync after remediation ticket creation failed");
  }

  // STEP C: for remediate-now, start a remediation run on the new task.
  let newRunId: number | null = null;
  if (action === "remediate-now") {
    try {
      const [newRun] = await db
        .insert(runsTable)
        .values({
          userId: req.userId,
          projectId: project.id,
          workItemId: internalTaskId,
          // Scheduled for immediate pickup by the cron dispatcher, which runs it
          // inline within its own (awaited) request — reliable on serverless,
          // unlike a fire-and-forget executeRun after this response returns.
          status: "scheduled",
          scheduledAt: new Date(),
          trigger: "scheduled",
          triggerContext: "remediation",
          parentRunId: runId,
          refinePrompt: buildRemediationPrompt(finding),
          autoCommit: false,
        })
        .returning();
      newRunId = newRun.id;

      updatedScan = mark({
        plmTicketKey: ticketKey,
        plmTicketUrl: ticketUrl,
        pushedToBoard: true,
        remediationRunId: newRun.id,
        remediationStatus: "pending",
      });
      await db.update(runsTable).set({ securityScan: updatedScan }).where(eq(runsTable.id, runId));

      audit.log({
        userId: req.userId,
        teamId: req.teamId ?? null,
        action: "aegis.remediation_started",
        entityType: "run",
        entityId: newRun.id,
        metadata: { findingId, ticketKey, parentRunId: runId },
        ipAddress: audit.getIp(req),
        userAgent: req.headers["user-agent"],
      });

      // The cron dispatcher (/api/internal/dispatch-runs, every 5 min) claims this
      // scheduled row and runs executeRun inline within its own request.
    } catch (runErr) {
      req.log.error({ runErr, findingId }, "Failed to create remediation run");
      // Non-fatal — ticket exists; the run can be started from the board.
    }
  }

  res.status(200).json({
    ticketKey,
    ticketUrl,
    newRunId,
    action,
    message:
      action === "remediate-now"
        ? `Ticket ${ticketKey} created. Remediation run ${newRunId ? `#${newRunId} ` : ""}queued — it starts automatically within a few minutes.`
        : `Ticket ${ticketKey} created and synced to board.`,
  });
});

export default router;
