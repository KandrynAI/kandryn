import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, projectsTable, repositoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  estimateForRepository,
  startBaselineScan,
  listScansForRepository,
  getScanWithFindings,
  acknowledgeFinding,
  loadScanTarget,
  loadFindingsForPush,
  markFindingPushed,
} from "../services/baselineScanService.js";
import { createAegisPlmTicket, getAegisIssueTypePref } from "../services/aegisPlmService.js";
import { RunError } from "../services/runService.js";
import * as audit from "../services/auditService.js";
import type { PlmProvider } from "../services/plmWrite.js";
import type { AegisFinding, SecuritySeverity, OwaspCategory } from "../../../../shared/types/aegisResult.js";

/**
 * Baseline security scan routes.
 *
 * Nothing here has a gate, a commit, or a block. A baseline scan reports on
 * code that already exists, so every response speaks in coverage
 * ("scanned N of M") and severity counts. Authorization goes through
 * `canRunBaselineScan` in the service — the one place the feature is gated —
 * rather than a middleware, so the answer accounts for the repository being
 * acted on and can grow a plan-entitlement check in a single edit.
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
function sendRunError(res: Parameters<IRouter["get"]>[1] extends never ? never : import("express").Response, err: unknown): boolean {
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
 * GET /repositories/:repoId/baseline/estimate — file count, cost and time.
 *
 * Read-only and free. Nothing is submitted until POST, and the POST re-checks
 * the count, so an admin can never approve one number and be charged for
 * another.
 */
router.get("/repositories/:repoId/baseline/estimate", async (req, res): Promise<void> => {
  const params = RepoIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid repository id" });
    return;
  }
  try {
    const { gate } = await loadScanTarget(params.data.repoId, actorOf(req));
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason });
      return;
    }
    res.json(await estimateForRepository(params.data.repoId, req.userId));
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
   * estimate is the failure mode worth catching, and a number the client had to
   * fetch first cannot be sent by accident.
   */
  acknowledgedFileCount: z.number().int().nonnegative(),
});

router.post("/repositories/:repoId/baseline", async (req, res): Promise<void> => {
  const params = RepoIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid repository id" });
    return;
  }
  const body = StartBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Confirm the estimate before starting a baseline scan." });
    return;
  }
  try {
    const { gate } = await loadScanTarget(params.data.repoId, actorOf(req));
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason });
      return;
    }

    // Re-price against the repository as it stands now. A scan is real money,
    // and the admin approved a specific number of files.
    const estimate = await estimateForRepository(params.data.repoId, req.userId);
    if (estimate.overCap) {
      res.status(422).json({
        error: `This repository has ${estimate.filesTotal} scannable files, above the ${estimate.maxFiles}-file limit for a baseline scan.`,
        estimate,
      });
      return;
    }
    if (estimate.filesTotal !== body.data.acknowledgedFileCount) {
      res.status(409).json({
        error: `This repository now has ${estimate.filesTotal} scannable files, not the ${body.data.acknowledgedFileCount} you approved. Review the new estimate.`,
        estimate,
      });
      return;
    }

    const scan = await startBaselineScan(params.data.repoId, actorOf(req));
    audit.log({
      userId: req.userId,
      teamId: scan.teamId,
      action: "baseline.scan_started",
      entityType: "baseline_scan",
      entityId: scan.id,
      metadata: {
        repositoryId: scan.repositoryId,
        projectId: scan.projectId,
        filesTotal: scan.filesTotal,
        filesSkipped: scan.filesSkipped,
        estimatedCostUsd: scan.estimatedCostUsd,
        batchId: scan.batchId,
        fileListSource: estimate.source,
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

router.get("/repositories/:repoId/baseline", async (req, res): Promise<void> => {
  const params = RepoIdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid repository id" });
    return;
  }
  try {
    const { canView, gate } = await loadScanTarget(params.data.repoId, actorOf(req));
    if (!canView) {
      // 404, not 403: a repository the caller cannot see should not be
      // confirmed to exist by the shape of the refusal.
      res.status(404).json({ error: "Repository not found" });
      return;
    }
    res.json({ scans: await listScansForRepository(params.data.repoId), canScan: gate.allowed, reason: gate.reason });
  } catch (err) {
    if (!sendRunError(res, err)) throw err;
  }
});

router.get("/baseline-scans/:id", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid scan id" });
    return;
  }
  try {
    const found = await getScanWithFindings(params.data.id);
    if (!found) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    const { canView, gate } = await loadScanTarget(found.scan.repositoryId, actorOf(req));
    if (!canView) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    res.json({ ...found, canScan: gate.allowed, reason: gate.reason });
  } catch (err) {
    if (!sendRunError(res, err)) throw err;
  }
});

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

const AcknowledgeBody = z.object({
  // Trimmed non-empty at the API as well as in the column CHECK. An
  // unexplained dismissal is not a decision anyone can audit later.
  reason: z.string().trim().min(1, "A reason is required.").max(2000),
});

router.post("/baseline-findings/:id/acknowledge", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid finding id" });
    return;
  }
  const body = AcknowledgeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "A reason is required to acknowledge a finding." });
    return;
  }
  try {
    const { finding, scan } = await acknowledgeFinding(params.data.id, body.data.reason, actorOf(req));
    audit.log({
      userId: req.userId,
      teamId: scan.teamId,
      action: "baseline.finding_acknowledged",
      entityType: "baseline_finding",
      entityId: finding.id,
      // Self-contained: a finding can be superseded by a later scan, so the
      // audit row records what was dismissed rather than pointing at it.
      metadata: {
        scanId: scan.id,
        repositoryId: scan.repositoryId,
        severity: finding.severity,
        owasp: finding.owasp,
        filePath: finding.filePath,
        title: finding.title,
        reason: finding.acknowledgeReason,
        fingerprint: finding.fingerprint,
      },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.json({ finding });
  } catch (err) {
    if (!sendRunError(res, err)) throw err;
  }
});

// ---------------------------------------------------------------------------
// PLM push — explicit selection only
// ---------------------------------------------------------------------------

const PushBody = z.object({
  /**
   * Exactly which findings become tickets. Never "all high and critical": a
   * runtime scan files one or two tickets per diff, a baseline scan of a real
   * codebase would file dozens in one go onto somebody's board.
   */
  findingIds: z.array(z.number().int().positive()).min(1).max(100),
});

/** Adapt a stored baseline finding to the shape the shared PLM writer expects. */
function toAegisFinding(f: {
  id: number;
  severity: string;
  owasp: string;
  filePath: string;
  title: string;
  detail: string;
  lineRef: string | null;
  remediation: string;
}): AegisFinding {
  return {
    id: `baseline-${f.id}`,
    severity: f.severity as SecuritySeverity,
    owasp: f.owasp as OwaspCategory,
    filePath: f.filePath,
    title: f.title,
    detail: f.detail,
    lineRef: f.lineRef ?? undefined,
    remediation: f.remediation,
  };
}

router.post("/baseline-scans/:id/push", async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid scan id" });
    return;
  }
  const body = PushBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Select at least one finding to push." });
    return;
  }
  try {
    const found = await getScanWithFindings(params.data.id);
    if (!found) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    const { gate } = await loadScanTarget(found.scan.repositoryId, actorOf(req));
    if (!gate.allowed) {
      res.status(403).json({ error: gate.reason });
      return;
    }
    if (found.scan.projectId == null) {
      res.status(422).json({ error: "This repository is not bound to a project, so there is no tracker to file into." });
      return;
    }
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, found.scan.projectId));
    if (!project?.plmProjectKey) {
      res.status(422).json({ error: "This project has no tracker project bound." });
      return;
    }
    const [repo] = await db.select().from(repositoriesTable).where(eq(repositoriesTable.id, found.scan.repositoryId));

    const selected = (await loadFindingsForPush(params.data.id, body.data.findingIds)).filter(
      (f) => f.status !== "pushed",
    );
    const issueTypePref = await getAegisIssueTypePref(req.userId, project.teamId);
    void issueTypePref; // recorded for parity; baseline tickets are always top-level Bugs

    const created: { findingId: number; ticketKey: string; ticketUrl: string }[] = [];
    for (const f of selected) {
      const ticket = await createAegisPlmTicket({
        finding: toAegisFinding(f),
        // No parent: the finding predates every work item in this project.
        // A Jira Sub-task cannot exist without one, so baseline files a Bug.
        parentExternalId: null,
        plmProvider: project.plmProvider as PlmProvider,
        plmProjectKey: project.plmProjectKey,
        userId: req.userId,
        projectId: project.id,
        repositoryId: repo?.id ?? null,
        issueType: "bug",
        teamId: project.teamId,
      });
      if (!ticket) continue;
      await markFindingPushed(f.id, ticket);
      created.push({ findingId: f.id, ticketKey: ticket.ticketKey, ticketUrl: ticket.ticketUrl });
    }

    audit.log({
      userId: req.userId,
      teamId: found.scan.teamId,
      action: "baseline.findings_pushed",
      entityType: "baseline_scan",
      entityId: found.scan.id,
      metadata: {
        repositoryId: found.scan.repositoryId,
        projectId: project.id,
        requested: body.data.findingIds.length,
        created: created.length,
        ticketKeys: created.map((c) => c.ticketKey),
      },
      ipAddress: audit.getIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.json({ created, requested: body.data.findingIds.length });
  } catch (err) {
    if (!sendRunError(res, err)) throw err;
  }
});

export default router;
