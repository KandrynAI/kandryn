import { Router, type IRouter } from "express";
import type { Response } from "express";
import { z } from "zod/v4";
import {
  estimateForRepository,
  startReview,
  listReviewsForRepository,
  getReviewWithFindings,
  acknowledgeFinding,
  loadReviewTarget,
  findingScan,
} from "../services/reviewScanService.js";
import { normalisePathPrefix } from "../services/baselineScanService.js";
import { RunError } from "../services/runService.js";
import * as audit from "../services/auditService.js";

/**
 * Whole-repository code review routes (0051).
 *
 * Shaped on the baseline security scan's routes on purpose: an admin learns
 * one flow, which is estimate, confirm, wait, triage. Nothing here has a gate,
 * a commit or a block. A review reports what a reviewer would raise on code
 * that already exists, so every response speaks in coverage ("reviewed N of
 * M") and severity counts.
 *
 * Authorization goes through the service rather than a middleware, so the
 * answer accounts for the repository being acted on and a plan entitlement
 * later lands in one function.
 */

const router: IRouter = Router();

const RepoIdParam = z.object({ repoId: z.coerce.number().int().positive() });
const IdParam = z.object({ id: z.coerce.number().int().positive() });

const actorOf = (req: { userId: string; teamId?: number | null; teamRole?: string | null }) => ({
  userId: req.userId,
  teamId: req.teamId ?? null,
  teamRole: req.teamRole ?? null,
});

/** Typed errors carry their own status; everything else propagates to the handler. */
function sendRunError(res: Response, err: unknown): boolean {
  if (err instanceof RunError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

/**
 * GET /repositories/:repoId/review/estimate — file count, cost and time.
 *
 * Read-only and free. Nothing is submitted until the POST, and the POST
 * re-prices under the same scope, so an admin can never approve one number and
 * be charged for another.
 */
router.get("/repositories/:repoId/review/estimate", async (req, res): Promise<void> => {
  const params = RepoIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid repository id" });
    return;
  }
  try {
    const { gate } = await loadReviewTarget(params.data.repoId, actorOf(req));
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason });
      return;
    }
    const prefix = normalisePathPrefix(req.query.path);
    if (prefix === false) {
      res.status(400).json({ error: "That folder path is not valid. Use a path inside the repository, like src/api." });
      return;
    }
    res.json(await estimateForRepository(params.data.repoId, req.userId, prefix));
  } catch (err) {
    if (!sendRunError(res, err)) throw err;
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const StartBody = z.object({
  /**
   * The file count the admin was shown. Not a boolean "confirmed": a stale
   * estimate is the failure worth catching, and a number the client had to
   * fetch first cannot be sent by accident.
   */
  acknowledgedFileCount: z.number().int().nonnegative(),
  pathPrefix: z.string().max(400).optional(),
});

router.post("/repositories/:repoId/review", async (req, res): Promise<void> => {
  const params = RepoIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid repository id" });
    return;
  }
  const body = StartBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Confirm the estimate before starting a code review." });
    return;
  }
  try {
    const { gate } = await loadReviewTarget(params.data.repoId, actorOf(req));
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason });
      return;
    }
    const prefix = normalisePathPrefix(body.data.pathPrefix);
    if (prefix === false) {
      res.status(400).json({ error: "That folder path is not valid. Use a path inside the repository, like src/api." });
      return;
    }

    // Re-price against the repository as it stands now, under the SAME scope
    // about to be reviewed. Pricing the whole repository while reviewing a
    // folder would compare two different numbers and reject every scoped
    // review on the count check below.
    const estimate = await estimateForRepository(params.data.repoId, req.userId, prefix);
    if (estimate.overCap) {
      res.status(422).json({
        error: prefix
          ? `"${prefix}" has ${estimate.filesTotal} reviewable files, above the ${estimate.maxFiles}-file limit for one review. Choose a folder inside it.`
          : `This repository has ${estimate.filesTotal} reviewable files, above the ${estimate.maxFiles}-file limit for a code review. Review a folder at a time instead.`,
        estimate,
      });
      return;
    }
    if (estimate.filesTotal !== body.data.acknowledgedFileCount) {
      res.status(409).json({
        error: `This repository now has ${estimate.filesTotal} reviewable files, not the ${body.data.acknowledgedFileCount} you approved. Review the new estimate.`,
        estimate,
      });
      return;
    }

    const scan = await startReview(params.data.repoId, actorOf(req), prefix);
    audit.log({
      userId: req.userId,
      teamId: scan.teamId,
      action: "review.scan_started",
      entityType: "review_scan",
      entityId: scan.id,
      metadata: {
        repositoryId: scan.repositoryId,
        projectId: scan.projectId,
        filesTotal: scan.filesTotal,
        filesSkipped: scan.filesSkipped,
        estimatedCostUsd: scan.estimatedCostUsd,
        batchId: scan.batchId,
        fileListSource: estimate.source,
        pathPrefix: prefix,
      },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.status(202).json({ scan });
  } catch (err) {
    if (!sendRunError(res, err)) throw err;
  }
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

router.get("/repositories/:repoId/review", async (req, res): Promise<void> => {
  const params = RepoIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid repository id" });
    return;
  }
  try {
    const { canView, gate } = await loadReviewTarget(params.data.repoId, actorOf(req));
    if (!canView) {
      // 404, not 403: a repository the caller cannot see should not be
      // confirmed to exist by the shape of the refusal.
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    res.json({
      scans: await listReviewsForRepository(params.data.repoId),
      canReview: gate.allowed,
      reason: gate.reason,
    });
  } catch (err) {
    if (!sendRunError(res, err)) throw err;
  }
});

router.get("/review-scans/:id", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid review id" });
    return;
  }
  try {
    const found = await getReviewWithFindings(params.data.id);
    if (!found) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    const { canView, gate } = await loadReviewTarget(found.scan.repositoryId, actorOf(req));
    if (!canView) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    res.json({ ...found, canReview: gate.allowed, reason: gate.reason });
  } catch (err) {
    if (!sendRunError(res, err)) throw err;
  }
});

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

const AcknowledgeBody = z.object({ reason: z.string().min(1).max(1_000) });

router.post("/review-findings/:id/acknowledge", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid finding id" });
    return;
  }
  const body = AcknowledgeBody.safeParse(req.body);
  if (!body.success) {
    // The reason is not optional, here or in the database. A dismissal with no
    // stated reason is indistinguishable from a finding nobody looked at, and
    // it is carried forward silently into every later review.
    res.status(400).json({ error: "Say why this finding is being dismissed." });
    return;
  }
  try {
    const scan = await findingScan(params.data.id);
    if (!scan) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }
    // Dismissing is a write, so it takes the same authority as starting a
    // review, not the wider read rule.
    const { gate } = await loadReviewTarget(scan.repositoryId, actorOf(req));
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason });
      return;
    }
    const updated = await acknowledgeFinding(params.data.id, req.userId, body.data.reason);
    if (!updated) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }
    audit.log({
      userId: req.userId,
      teamId: scan.teamId,
      action: "review.finding_acknowledged",
      entityType: "review_finding",
      entityId: updated.id,
      metadata: {
        scanId: scan.id,
        repositoryId: scan.repositoryId,
        severity: updated.severity,
        category: updated.category,
        filePath: updated.filePath,
      },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.json({ finding: updated });
  } catch (err) {
    if (!sendRunError(res, err)) throw err;
  }
});

export default router;
