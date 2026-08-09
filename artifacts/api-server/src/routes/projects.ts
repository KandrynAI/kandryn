import { Router, type IRouter } from "express";
import { and, eq, isNull, inArray, or, sql } from "drizzle-orm";
import { db, projectsTable, repositoriesTable, tasksTable, runsTable } from "@workspace/db";
import { z } from "zod/v4";
import { listPlmProjects, validatePlmProject, PlmError } from "../services/plmProjects.js";
import { syncProject } from "../services/syncService.js";
import { createPlmWorkItem } from "../services/plmWrite.js";

const router: IRouter = Router();

const CreateProjectBody = z.object({
  name: z.string().min(1, "Project name is required").max(160),
  plmProvider: z.enum(["jira", "azure-devops"]),
  plmProjectKey: z.string().min(1, "A PLM project is required").max(200),
  repositoryId: z.coerce.number().int().positive(),
});

const UpdateProjectBody = z.object({
  name: z.string().min(1).max(160).optional(),
  defaultTarget: z.enum(["story", "task"]).optional(),
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Idempotent backfill of legacy tasks into projects (spec §2.5). Groups a
 * user's project-less tasks by repository, binds one "Migrated" project per
 * repo, and attaches the tasks. Tasks with no repository can't bind (skipped).
 * Safe to re-run: existing migrated projects are reused; only still-orphan
 * tasks are attached.
 */
async function backfillUserProjects(userId: string) {
  const orphans = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), isNull(tasksTable.projectId)));

  const byRepo = new Map<number, typeof orphans>();
  let skipped = 0;
  for (const t of orphans) {
    if (t.repositoryId == null) {
      skipped++;
      continue;
    }
    const list = byRepo.get(t.repositoryId) ?? [];
    list.push(t);
    byRepo.set(t.repositoryId, list);
  }

  let created = 0;
  let attached = 0;
  for (const [repoId, tasksForRepo] of byRepo) {
    const source = tasksForRepo.find((t) => t.source === "azure-devops")?.source;
    const plmProvider: "jira" | "azure-devops" = source === "azure-devops" ? "azure-devops" : "jira";

    let [proj] = await db
      .select()
      .from(projectsTable)
      .where(
        and(
          eq(projectsTable.userId, userId),
          eq(projectsTable.repositoryId, repoId),
          isNull(projectsTable.plmProjectKey),
        ),
      );

    if (!proj) {
      const [repo] = await db
        .select()
        .from(repositoriesTable)
        .where(eq(repositoriesTable.id, repoId));
      [proj] = await db
        .insert(projectsTable)
        .values({
          userId,
          name: repo ? `Migrated: ${repo.name}` : "Migrated project",
          plmProvider,
          plmProjectKey: null,
          plmProjectName: null,
          repositoryId: repoId,
        })
        .returning();
      created++;
    }

    const updated = await db
      .update(tasksTable)
      .set({ projectId: proj.id })
      .where(
        and(
          eq(tasksTable.userId, userId),
          eq(tasksTable.repositoryId, repoId),
          isNull(tasksTable.projectId),
        ),
      )
      .returning({ id: tasksTable.id });
    attached += updated.length;
  }

  return { created, attached, skipped };
}

// --- List with counts -------------------------------------------------------
router.get("/projects", async (req, res): Promise<void> => {
  // Own projects plus any team-visible project of the caller's team (0017).
  const projects = await db
    .select()
    .from(projectsTable)
    .where(
      or(
        eq(projectsTable.userId, req.userId),
        and(eq(projectsTable.teamId, req.teamId ?? -1), eq(projectsTable.visibility, "team")),
      ),
    )
    .orderBy(projectsTable.createdAt);

  const itemCounts = await db
    .select({
      projectId: tasksTable.projectId,
      status: tasksTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tasksTable)
    .where(eq(tasksTable.userId, req.userId))
    .groupBy(tasksTable.projectId, tasksTable.status);

  const runCounts = await db
    .select({ projectId: runsTable.projectId, count: sql<number>`count(*)::int` })
    .from(runsTable)
    .where(and(eq(runsTable.userId, req.userId), inArray(runsTable.status, ["queued", "running"])))
    .groupBy(runsTable.projectId);

  const openBy = new Map<number, number>();
  const reviewBy = new Map<number, number>();
  const runningBy = new Map<number, number>();
  for (const r of itemCounts) {
    if (r.projectId == null) continue;
    if (r.status === "open") openBy.set(r.projectId, (openBy.get(r.projectId) ?? 0) + r.count);
    if (r.status === "review") reviewBy.set(r.projectId, (reviewBy.get(r.projectId) ?? 0) + r.count);
  }
  for (const r of runCounts) {
    if (r.projectId != null) runningBy.set(r.projectId, r.count);
  }

  res.json(
    projects.map((p) => ({
      ...p,
      counts: {
        open: openBy.get(p.id) ?? 0,
        running: runningBy.get(p.id) ?? 0,
        review: reviewBy.get(p.id) ?? 0,
      },
    })),
  );
});

// --- Create (validates both bindings live) ----------------------------------
router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
    return;
  }
  const { name, plmProvider, plmProjectKey, repositoryId } = parsed.data;

  // Duplicate-binding guard (unique on user_id, plm_provider, plm_project_key).
  // Catch it here with a friendly 409 instead of letting the unique index throw
  // a raw constraint error that the global handler would surface as a 500.
  const [existing] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.userId, req.userId),
        eq(projectsTable.plmProvider, plmProvider),
        eq(projectsTable.plmProjectKey, plmProjectKey),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({
      error: `A project is already connected to this ${
        plmProvider === "jira" ? "Jira" : "Azure DevOps"
      } project (${plmProjectKey}). Open the existing project or delete it first.`,
      existingProjectId: existing.id,
    });
    return;
  }

  // Git binding: the repo must exist and belong to this user (validated live at connect time).
  const [repo] = await db
    .select()
    .from(repositoriesTable)
    .where(and(eq(repositoriesTable.id, repositoryId), eq(repositoriesTable.userId, req.userId)));
  if (!repo) {
    res.status(422).json({ error: "Repository not found or not yours." });
    return;
  }

  // PLM binding: confirm the project is visible with the user's credentials.
  let plmName: string | undefined;
  try {
    const v = await validatePlmProject(req.userId, plmProvider, plmProjectKey);
    if (!v.ok) {
      res.status(422).json({
        error: `Project "${plmProjectKey}" was not found in ${
          plmProvider === "jira" ? "Jira" : "Azure DevOps"
        } with your credentials.`,
      });
      return;
    }
    plmName = v.name;
  } catch (err) {
    if (err instanceof PlmError) {
      res.status(424).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }

  try {
    const [proj] = await db
      .insert(projectsTable)
      .values({
        userId: req.userId,
        name,
        plmProvider,
        plmProjectKey,
        plmProjectName: plmName ?? null,
        repositoryId,
        // Team context (0017): a new project created by a team member is
        // team-visible; a user with no team keeps it personal.
        teamId: req.teamId ?? null,
        visibility: req.teamId ? "team" : "personal",
      })
      .returning();
    req.log.info({ projectId: proj.id, plmProvider, plmProjectKey }, "Project created");
    res.status(201).json(proj);
  } catch (err) {
    // Lost a race with a concurrent create. Drizzle wraps the pg error, so the
    // SQLSTATE lives on err.cause.code (not err.code).
    const code =
      (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "You already have a project bound to that PLM project." });
      return;
    }
    throw err;
  }
});

// --- Backfill (static path — before /:id) -----------------------------------
router.post("/projects/backfill", async (req, res): Promise<void> => {
  const result = await backfillUserProjects(req.userId);
  req.log.info(result, "Project backfill complete");
  res.json(result);
});

// --- PLM project list (wizard helper) ---------------------------------------
router.get("/plm/:provider/projects", async (req, res): Promise<void> => {
  const provider = req.params.provider;
  if (provider !== "jira" && provider !== "azure-devops") {
    res.status(400).json({ error: "Unknown PLM provider" });
    return;
  }
  try {
    const projects = await listPlmProjects(req.userId, provider);
    res.json(projects);
  } catch (err) {
    if (err instanceof PlmError) {
      res.status(424).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

// --- Detail / update / delete -----------------------------------------------
router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const [proj] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, req.userId)));
  if (!proj) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(proj);
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
    return;
  }
  const [proj] = await db
    .update(projectsTable)
    .set(parsed.data)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, req.userId)))
    .returning();
  if (!proj) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(proj);
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  // FK cascades delete the project's work items and runs; never touches the PLM.
  const [proj] = await db
    .delete(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, req.userId)))
    .returning();
  if (!proj) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.sendStatus(204);
});

// --- Hierarchy sync (Phase 2) -----------------------------------------------
router.post("/projects/:id/sync", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const [proj] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, req.userId)));
  if (!proj) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const summary = await syncProject(req.userId, params.data.id);
    res.json(summary);
  } catch (err) {
    if (err instanceof PlmError) {
      res.status(err.code === "not_connected" ? 424 : 502).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// --- Work items (flat, project-scoped) --------------------------------------
// Phase 1: flat list for the board. Phase 2 extends this with tree/filter params
// and full hierarchy sync. Returns raw rows (incl. project_id, item_type,
// parent_id, plm_url, plm_status) — unlike GET /api/tasks which strips them.
router.get("/projects/:id/work-items", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const [proj] = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, req.userId)));
  if (!proj) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const items = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.projectId, params.data.id), eq(tasksTable.userId, req.userId)))
    .orderBy(tasksTable.createdAt);
  res.json(items);
});

// --- Create a work item (Phase 4) -------------------------------------------
// pushToPlm=true creates it in Jira/ADO first, then stores the returned
// key/URL locally. pushToPlm=false is a local-only ("manual") item.
const CreateWorkItemBody = z.object({
  itemType: z.enum(["epic", "story", "task", "bug"]),
  title: z.string().min(1).max(200),
  description: z.string().max(20000).optional(),
  acceptanceCriteria: z.string().max(20000).optional(),
  parentId: z.coerce.number().int().positive().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
  pushToPlm: z.boolean().optional().default(false),
});

router.post("/projects/:id/work-items", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const parsed = CreateWorkItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid submission" });
    return;
  }
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.userId, req.userId)));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { itemType, title, description, acceptanceCriteria, parentId, priority, pushToPlm } = parsed.data;

  // Resolve the parent (must belong to the same project) for hierarchy linkage.
  let parent: typeof tasksTable.$inferSelect | undefined;
  if (parentId != null) {
    [parent] = await db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.id, parentId),
          eq(tasksTable.userId, req.userId),
          eq(tasksTable.projectId, project.id),
        ),
      );
    if (!parent) {
      res.status(422).json({ error: "Parent work item not found in this project." });
      return;
    }
  }

  let externalId: string | null = null;
  let plmUrl: string | null = null;
  let plmStatus: string | null = null;
  let source = "manual";

  if (pushToPlm) {
    try {
      const result = await createPlmWorkItem(
        req.userId,
        { plmProvider: project.plmProvider, plmProjectKey: project.plmProjectKey },
        { itemType, title, description, acceptanceCriteria, parentExternalId: parent?.externalId ?? null },
      );
      externalId = result.externalId;
      plmUrl = result.plmUrl;
      plmStatus = result.plmStatus;
      source = project.plmProvider;
    } catch (err) {
      if (err instanceof PlmError) {
        res.status(err.code === "not_connected" ? 424 : 502).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  const [item] = await db
    .insert(tasksTable)
    .values({
      userId: req.userId,
      projectId: project.id,
      repositoryId: project.repositoryId,
      externalId,
      source,
      type: itemType,
      itemType,
      title,
      description: description ?? null,
      acceptanceCriteria: acceptanceCriteria ?? null,
      priority,
      status: "open",
      parentId: parent?.id ?? null,
      plmUrl,
      plmStatus,
    })
    .returning();

  req.log.info({ workItemId: item.id, projectId: project.id, pushToPlm }, "Work item created");
  res.status(201).json(item);
});

export default router;
