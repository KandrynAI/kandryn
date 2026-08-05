import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, runsTable, tasksTable, suggestionsTable } from "@workspace/db";
import { z } from "zod/v4";
import { executeRun, commitFromSuggestion, RunError } from "../services/runService.js";
import { getConfigs } from "../services/configService.js";
import { runVeriaReview } from "../services/veriaService.js";

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
        status: "scheduled",
        trigger: "scheduled",
        refinePrompt: refinePrompt ?? null,
        autoCommit,
        scheduledAt: when,
      })
      .returning();
    req.log.info({ runId: run.id, workItemId: workItem.id, scheduledAt }, "Run scheduled");
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
      status: "queued",
      trigger: "manual",
      refinePrompt: refinePrompt ?? null,
      autoCommit,
    })
    .returning();

  req.log.info({ runId: run.id, workItemId: workItem.id, autoCommit }, "Run started inline");
  await executeRun(run.id);

  const [finished] = await db.select().from(runsTable).where(eq(runsTable.id, run.id));
  const suggestions = await db
    .select()
    .from(suggestionsTable)
    .where(eq(suggestionsTable.runId, run.id))
    .orderBy(desc(suggestionsTable.score));
  res.status(201).json({ run: finished, suggestions });
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

  // A per-item lookup wants a short recent history; the broad list keeps 200.
  const limit = query.data.workItemId != null ? 10 : 200;
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
  const [run] = await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, params.data.id), eq(runsTable.userId, req.userId)));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const suggestions = await db
    .select()
    .from(suggestionsTable)
    .where(eq(suggestionsTable.runId, run.id))
    .orderBy(desc(suggestionsTable.score));

  // Minimal work-item summary so the client can gate PLM actions (e.g. pushing
  // test cases) on the item's real PLM-link state instead of assuming it.
  const [workItem] = await db
    .select({ externalId: tasksTable.externalId, source: tasksTable.source })
    .from(tasksTable)
    .where(eq(tasksTable.id, run.workItemId));

  res.json({ run, suggestions, workItem: workItem ?? null });
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

  try {
    const review = await runVeriaReview(
      {
        itemTitle: workItem?.title ?? "Untitled work item",
        itemType: workItem?.itemType ?? workItem?.type ?? "task",
        acceptanceCriteria,
        suggestionAgent: suggestion.agent,
        suggestionFilePath: suggestion.filePath,
        suggestionCode: suggestion.code,
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

export default router;
