import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod/v4";
import { db, projectsTable, uiStyleProfilesTable } from "@workspace/db";
import { canAdminister } from "../services/resourceAdmin.js";
import * as audit from "../services/auditService.js";
import { claimProfile, ensureProfileRow, getProfile, runExtraction } from "../services/uiStyleService.js";

/**
 * The UI style profile (0042): how this project's interface is already
 * styled, read from the repository by static parsing.
 *
 * Access mirrors the Knowledge routes rather than inventing a third rule:
 * reading uses the `GET /projects` test (owner, or team member of a
 * team-visible project), writing uses `canAdminister`. Anything out of scope
 * is 404, never 403 — the project is not the caller's to know about.
 */

const router: IRouter = Router();

const ProjectParam = z.object({ id: z.coerce.number().int().positive() });

const UpdateRequest = z
  .object({
    enabled: z.boolean().optional(),
    uiRoot: z.string().min(1).max(400).optional(),
  })
  .refine((b) => b.enabled !== undefined || b.uiRoot !== undefined, {
    message: "Provide enabled or uiRoot.",
  });

type Actor = { userId: string; teamId?: number | null; teamRole?: string | null };

const actorOf = (req: { userId: string; teamId?: number | null; teamRole?: string | null }): Actor => ({
  userId: req.userId,
  teamId: req.teamId ?? null,
  teamRole: req.teamRole ?? null,
});

async function readableProject(actor: Actor, projectId: number) {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.id, projectId),
        or(
          eq(projectsTable.userId, actor.userId),
          and(eq(projectsTable.teamId, actor.teamId ?? -1), eq(projectsTable.visibility, "team")),
        ),
      ),
    );
  return project ?? null;
}

function canWrite(actor: Actor, project: { userId: string; teamId: number | null }): boolean {
  return (
    project.userId === actor.userId ||
    canAdminister(
      { userId: actor.userId, teamId: actor.teamId ?? null, teamRole: actor.teamRole ?? null },
      { ownerUserId: project.userId, teamId: project.teamId },
    )
  );
}

/** The client shape. `canEdit` drives the tab's read-only mode. */
function present(row: Awaited<ReturnType<typeof getProfile>>, canEdit: boolean) {
  if (!row) return { status: "none" as const, canEdit };
  return {
    status: row.status,
    canEdit,
    stale: row.stale,
    enabled: row.enabled,
    revision: row.revision,
    uiRoot: row.uiRoot,
    uiRootOptions: row.uiRootOptions ?? [],
    sourceRef: row.sourceRef,
    framework: row.framework,
    tokens: row.tokens,
    components: row.components,
    conventions: row.conventions,
    exemplars: row.exemplars,
    warnings: row.warnings ?? [],
    error: row.error,
    extractedAt: row.extractedAt,
  };
}

// ---------------------------------------------------------------------------
// GET /projects/:id/ui-style
// ---------------------------------------------------------------------------

router.get("/projects/:id/ui-style", async (req, res): Promise<void> => {
  const params = ProjectParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const project = await readableProject(actorOf(req), params.data.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const row = await getProfile(project.userId, project.id);
  res.json(present(row, canWrite(actorOf(req), project)));
});

// ---------------------------------------------------------------------------
// POST /projects/:id/ui-style/extract
// ---------------------------------------------------------------------------

router.post("/projects/:id/ui-style/extract", async (req, res): Promise<void> => {
  const params = ProjectParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const project = await readableProject(actorOf(req), params.data.id);
  if (!project || !canWrite(actorOf(req), project)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // A project connected before this feature existed has no row yet.
  await ensureProfileRow(project.userId, project.id, null);

  const claim = await claimProfile(project.id);
  if (!claim.claimed) {
    // Someone else is already extracting and claimed it recently. Say so with
    // the current row rather than starting a second pass over the same repo.
    res.status(202).json(present(claim.row, true));
    return;
  }

  const row = await runExtraction(claim.row);

  audit.log({
    userId: req.userId,
    teamId: req.teamId ?? null,
    action: "ui_style.extracted",
    entityType: "ui_style_profile",
    entityId: claim.row.id,
    metadata: {
      revision: row?.revision ?? claim.row.revision,
      status: row?.status ?? "failed",
      tokens: row?.tokens ? Object.values(row.tokens).reduce((n, l) => n + (l as unknown[]).length, 0) : 0,
      components: row?.components?.length ?? 0,
      warnings: row?.warnings?.length ?? 0,
    },
    ipAddress: audit.getIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.json(present(row, true));
});

// ---------------------------------------------------------------------------
// PATCH /projects/:id/ui-style
// ---------------------------------------------------------------------------

router.patch("/projects/:id/ui-style", async (req, res): Promise<void> => {
  const params = ProjectParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const parsed = UpdateRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide enabled or uiRoot.", details: z.treeifyError(parsed.error) });
    return;
  }
  const project = await readableProject(actorOf(req), params.data.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  // The project is visible but this caller may not change its settings — a
  // genuine 403, unlike a project they cannot see at all.
  if (!canWrite(actorOf(req), project)) {
    res.status(403).json({ error: "Only the project owner or a team admin can change this." });
    return;
  }

  const existing = await getProfile(project.userId, project.id);
  if (!existing) {
    res.status(404).json({ error: "No UI style profile for this project yet." });
    return;
  }

  const { enabled, uiRoot } = parsed.data;
  const changed: string[] = [];
  const set: Partial<typeof uiStyleProfilesTable.$inferInsert> = {};

  if (enabled !== undefined) {
    set.enabled = enabled;
    changed.push("enabled");
  }
  if (uiRoot !== undefined) {
    const options = existing.uiRootOptions ?? [];
    if (!options.includes(uiRoot)) {
      res.status(400).json({ error: "That UI location is not one of the detected options." });
      return;
    }
    if (uiRoot !== existing.uiRoot) {
      // A different root is a different profile, so it is re-read rather than
      // patched: the tokens and components on the row describe the old one.
      set.uiRoot = uiRoot;
      set.status = "pending";
      set.claimedAt = null;
      changed.push("uiRoot");
    }
  }

  const [updated] = await db
    .update(uiStyleProfilesTable)
    .set(set)
    .where(and(eq(uiStyleProfilesTable.id, existing.id), eq(uiStyleProfilesTable.userId, project.userId)))
    .returning();

  if (changed.length > 0) {
    audit.log({
      userId: req.userId,
      teamId: req.teamId ?? null,
      action: "ui_style.updated",
      entityType: "ui_style_profile",
      entityId: existing.id,
      metadata: { changed, enabled: updated?.enabled, uiRoot: updated?.uiRoot },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
  }

  res.json(present(updated ?? existing, true));
});

export default router;
