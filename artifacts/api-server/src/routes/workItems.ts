import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, tasksTable, projectsTable, repositoriesTable } from "@workspace/db";
import { z } from "zod/v4";
import { getConfigs } from "../services/configService.js";
import { getProjectRepository } from "../services/repoResolver.js";
import { PLMService } from "../services/plmService.js";
import { generateBreakdown, AIFormatError } from "../services/aiService.js";
import { createPlmWorkItem, type CreatableType, type PlmProvider } from "../services/plmWrite.js";
import { PlmError } from "../services/plmProjects.js";
import type { StackProfile } from "../stack/detector.js";

const CREATABLE_TYPES = new Set<CreatableType>(["epic", "story", "task", "bug"]);

const router: IRouter = Router();

const IdParam = z.object({ id: z.coerce.number().int().positive() });

// ---------------------------------------------------------------------------
// PATCH /work-items/:id — local edit; a move to `done` propagates to the PLM
// (v1: only `done` propagates via the existing closeTask; other transitions
// are local-only — spec §3.2).
// ---------------------------------------------------------------------------
const UpdateWorkItemBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20000).optional(),
  acceptanceCriteria: z.string().max(20000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["open", "in-progress", "review", "done", "blocked"]).optional(),
  itemType: z.enum(["epic", "story", "task", "bug", "test_case"]).optional(),
});

router.patch("/work-items/:id", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid work item id" });
    return;
  }
  const parsed = UpdateWorkItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
    return;
  }

  const [item] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.userId, req.userId)));
  if (!item) {
    res.status(404).json({ error: "Work item not found" });
    return;
  }

  const patch = parsed.data;
  const movingToDone = patch.status === "done" && item.status !== "done";

  // Propagate a close to the PLM before touching local state, so a PLM failure
  // doesn't leave us out of sync (throws → 5xx below via the error handler).
  if (movingToDone && item.externalId && (item.source === "azure-devops" || item.source === "jira")) {
    const creds = await getConfigs(req.userId, [
      "AZURE_DEVOPS_ORG",
      "AZURE_DEVOPS_PROJECT",
      "AZURE_DEVOPS_PAT",
      "JIRA_DOMAIN",
      "JIRA_EMAIL",
      "JIRA_API_TOKEN",
    ]);
    const plm = new PLMService({
      azureOrg: creds.AZURE_DEVOPS_ORG,
      azureProject: creds.AZURE_DEVOPS_PROJECT,
      azurePat: creds.AZURE_DEVOPS_PAT,
      jiraDomain: creds.JIRA_DOMAIN,
      jiraEmail: creds.JIRA_EMAIL,
      jiraToken: creds.JIRA_API_TOKEN,
    });
    try {
      await plm.closeTask(
        item.source as "azure-devops" | "jira",
        item.externalId,
        item.linkedCommit ?? "(closed from Blue Mantis)",
      );
    } catch (err) {
      req.log.warn({ workItemId: item.id, err }, "Failed to propagate close to PLM");
      res.status(502).json({ error: "Could not update the item in the PLM. Nothing was changed." });
      return;
    }
  }

  // Keep the legacy `type` column aligned with itemType when it changes.
  const updates = { ...patch } as Record<string, unknown>;
  if (patch.itemType) updates.type = patch.itemType;

  const [updated] = await db
    .update(tasksTable)
    .set(updates)
    .where(and(eq(tasksTable.id, item.id), eq(tasksTable.userId, req.userId)))
    .returning();

  req.log.info({ workItemId: item.id, status: patch.status }, "Work item updated");
  res.json(updated);
});

// ---------------------------------------------------------------------------
// POST /work-items/:id/breakdown — AI decomposition into child proposals.
// Proposals are returned, NOT saved; the client edits/approves, then calls
// POST /projects/:id/work-items per approved child (spec §3.2).
// ---------------------------------------------------------------------------
router.post("/work-items/:id/breakdown", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid work item id" });
    return;
  }

  const [item] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.userId, req.userId)));
  if (!item) {
    res.status(404).json({ error: "Work item not found" });
    return;
  }

  const creds = await getConfigs(req.userId, ["ANTHROPIC_API_KEY"]);
  if (!creds.ANTHROPIC_API_KEY) {
    res.status(424).json({ error: "Add your Anthropic API key in Integrations to use AI breakdown." });
    return;
  }

  // Best-effort stack for a grounded prompt. Resolve the repo via project_id
  // (0020), not the deprecated projects.repository_id.
  let stack: StackProfile | null = null;
  if (item.projectId != null) {
    const repo = await getProjectRepository(item.projectId, req.userId);
    stack = (repo?.stackProfile as StackProfile) ?? null;
  }

  try {
    const children = await generateBreakdown(
      {
        itemType: item.itemType,
        title: item.title,
        description: item.description ?? "",
        acceptanceCriteria: item.acceptanceCriteria
          ? item.acceptanceCriteria.split(/\n/).map((s) => s.trim()).filter(Boolean)
          : [],
      },
      { anthropicApiKey: creds.ANTHROPIC_API_KEY },
      stack,
    );
    req.log.info({ workItemId: item.id, count: children.length }, "Breakdown generated");
    res.json({ parentId: item.id, children });
  } catch (err) {
    if (err instanceof AIFormatError) {
      res.status(422).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /work-items/:id/push-to-plm — promote a local-only work item into the
// project's bound PLM (Jira/ADO). Creates the story upstream, then records the
// returned key/URL locally so it becomes a first-class PLM-linked item (e.g.
// test cases can then be pushed under it). Idempotent-ish: an already-linked
// item returns 409 with its existing linkage.
// ---------------------------------------------------------------------------
router.post("/work-items/:id/push-to-plm", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid work item id" });
    return;
  }

  const [item] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, params.data.id), eq(tasksTable.userId, req.userId)));
  if (!item) {
    res.status(404).json({ error: "Work item not found" });
    return;
  }

  // Already linked — nothing to do.
  if (item.externalId && (item.source === "jira" || item.source === "azure-devops")) {
    res.status(409).json({
      error: "This work item is already linked to a PLM story.",
      externalId: item.externalId,
      plmUrl: item.plmUrl,
    });
    return;
  }
  if (!CREATABLE_TYPES.has(item.itemType as CreatableType)) {
    res.status(422).json({ error: `A ${item.itemType} can't be pushed to the PLM as a standalone story.` });
    return;
  }
  if (item.projectId == null) {
    res.status(422).json({ error: "Work item is not attached to a project." });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, item.projectId));
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  // Resolve the parent's PLM key for hierarchy linkage (best-effort — only if
  // the parent itself is already PLM-linked).
  let parentExternalId: string | null = null;
  if (item.parentId != null) {
    const [parent] = await db
      .select({ externalId: tasksTable.externalId })
      .from(tasksTable)
      .where(and(eq(tasksTable.id, item.parentId), eq(tasksTable.userId, req.userId)));
    parentExternalId = parent?.externalId ?? null;
  }

  let result;
  try {
    result = await createPlmWorkItem(
      req.userId,
      { plmProvider: project.plmProvider as PlmProvider, plmProjectKey: project.plmProjectKey },
      {
        itemType: item.itemType as CreatableType,
        title: item.title,
        description: item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        parentExternalId,
      },
      req.teamId ?? null,
    );
  } catch (err) {
    if (err instanceof PlmError) {
      res.status(err.code === "not_connected" ? 424 : 502).json({ error: err.message });
      return;
    }
    throw err;
  }

  const [updated] = await db
    .update(tasksTable)
    .set({
      externalId: result.externalId,
      source: project.plmProvider,
      plmUrl: result.plmUrl,
      plmStatus: result.plmStatus,
    })
    .where(and(eq(tasksTable.id, item.id), eq(tasksTable.userId, req.userId)))
    .returning();

  req.log.info({ workItemId: item.id, externalId: result.externalId }, "Work item pushed to PLM");
  res.json(updated);
});

export default router;
