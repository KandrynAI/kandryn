import { Router, type IRouter } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod/v4";
import { db, domainExtractionsTable, projectsTable } from "@workspace/db";
import { canAdminister } from "../services/resourceAdmin.js";
import * as audit from "../services/auditService.js";
import { DomainExtractError, requestExtraction } from "../services/domainExtractService.js";

/**
 * Domain extraction (0052, PR 2b).
 *
 * One route: ask for an extraction. There is deliberately no read endpoint
 * and no listing of rules, because the review queue is PR 2c and an endpoint
 * that hands out `proposed` statements before anything can mark them
 * confirmed or rejected invites a caller to treat them as settled. Until then
 * the extraction's progress is in its row and in the logs.
 *
 * Access mirrors the UI style and Knowledge routes rather than inventing a
 * third rule: a project the caller cannot read is 404, never 403, and
 * starting work on one needs `canAdminister`.
 */

const router: IRouter = Router();

const ProjectParam = z.object({ id: z.coerce.number().int().positive() });

type Actor = { userId: string; teamId: number | null; teamRole: string | null };

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

// POST /projects/:id/domain/extract — read this project's sources and propose
// domain statements. Answers 202: the dispatcher does the work.
router.post("/projects/:id/domain/extract", async (req, res): Promise<void> => {
  const params = ProjectParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const actor = actorOf(req);
  const project = await readableProject(actor, params.data.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const canWrite =
    project.userId === actor.userId ||
    canAdminister(actor, { ownerUserId: project.userId, teamId: project.teamId });
  if (!canWrite) {
    res.status(403).json({ error: "Only a workspace admin can start an extraction." });
    return;
  }

  try {
    const extraction = await requestExtraction(project.id, {
      userId: actor.userId,
      teamId: project.teamId,
      triggeredBy: actor.userId,
    });
    audit.log({
      userId: actor.userId,
      teamId: project.teamId,
      action: "domain.extraction_started",
      entityType: "project",
      entityId: project.id,
      metadata: { extractionId: extraction.id },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.status(202).json({ extraction });
  } catch (err) {
    if (err instanceof DomainExtractError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
