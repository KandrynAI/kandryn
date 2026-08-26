import { Router, type IRouter, type Request, type Response } from "express";
import { sql, eq } from "drizzle-orm";
import { db, repositoriesTable } from "@workspace/db";
import { executeRun } from "../services/runService.js";
import { runRetentionCleanup, verifyAllChains } from "../services/auditService.js";
import { backfillEncryption } from "../services/configService.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// How many due runs one dispatch tick claims. Kept small so a single serverless
// invocation stays well under its time budget; the cron fires every 5 min and
// drains the backlog across ticks.
const DISPATCH_BATCH = 2;
// A running row older than this is considered stuck (its serverless invocation
// died before it could record success/failure) and is swept to failed.
const STUCK_MINUTES = 20;

/**
 * Constant-time-ish bearer check against CRON_SECRET. Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>` when the secret is configured. When no
 * secret is set the endpoint is refused outright (never left open).
 */
function authorized(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (!header) return false;
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Cron-only dispatcher (spec §5.4). Not behind requireAuth — mounted before it
 * and guarded by CRON_SECRET. Two jobs each tick:
 *   1. Sweep stuck `running` rows (>20 min) to `failed`.
 *   2. Claim up to DISPATCH_BATCH due `scheduled` rows with FOR UPDATE SKIP
 *      LOCKED so concurrent ticks never grab the same run, flip them to
 *      `queued`, and execute each inline.
 */
async function dispatchHandler(req: Request, res: Response): Promise<void> {
  if (!authorized(req.header("authorization"))) {
    res.sendStatus(401);
    return;
  }

  // 1. Stuck-run sweep.
  const swept = await db.execute(
    sql`UPDATE runs SET status = 'failed', finished_at = now(),
          error = 'Run timed out (no result recorded within ${sql.raw(String(STUCK_MINUTES))} minutes).'
        WHERE status = 'running'
          AND started_at < now() - interval '${sql.raw(String(STUCK_MINUTES))} minutes'
        RETURNING id`,
  );
  const sweptCount = swept.rows.length;

  // 2. Atomically claim due scheduled runs.
  const claimed = await db.execute(
    sql`UPDATE runs SET status = 'queued'
        WHERE id IN (
          SELECT id FROM runs
          WHERE status = 'scheduled' AND scheduled_at <= now()
          ORDER BY scheduled_at
          LIMIT ${sql.raw(String(DISPATCH_BATCH))}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`,
  );
  const ids = claimed.rows.map((r) => Number((r as { id: number }).id));

  if (sweptCount > 0 || ids.length > 0) {
    logger.info({ swept: sweptCount, claimed: ids }, "dispatch-runs tick");
  }

  // Execute claimed runs sequentially — each executeRun never throws (it records
  // failure on the row), so one bad run can't abort the batch.
  for (const id of ids) {
    await executeRun(id);
  }

  res.json({ swept: sweptCount, dispatched: ids.length });
}

// Vercel Cron invokes the path with a GET; POST is accepted too for manual
// triggering. Both still require the CRON_SECRET bearer (checked in-handler).
router.get("/internal/dispatch-runs", dispatchHandler);
router.post("/internal/dispatch-runs", dispatchHandler);

/**
 * Nightly audit-log retention cleanup. Not behind requireAuth — mounted before
 * it and guarded by the same CRON_SECRET bearer as the dispatcher. Deletes rows
 * older than each team's plan retention window (and orphan rows > 30 days).
 * Intended to be invoked by a Vercel cron; can also be triggered manually.
 */
async function auditCleanupHandler(req: Request, res: Response): Promise<void> {
  if (!authorized(req.header("authorization"))) {
    res.sendStatus(401);
    return;
  }
  const result = await runRetentionCleanup();
  logger.info({ deleted: result.deleted }, "Audit log retention cleanup complete");
  // Verify the tamper-evident hash chains after retention has pruned old rows
  // (governance item 7). Verification runs on the retained set; a broken chain is
  // logged loudly for investigation.
  const broken = await verifyAllChains();
  if (broken.length > 0) {
    logger.error({ broken }, "Audit hash-chain verification FAILED for one or more teams");
  } else {
    logger.info("Audit hash-chain verification passed for all teams");
  }
  res.json({ deleted: result.deleted, chainsBroken: broken.length });
}

router.get("/internal/audit-cleanup", auditCleanupHandler);
router.post("/internal/audit-cleanup", auditCleanupHandler);

/**
 * One-time credential-encryption backfill. Not behind requireAuth — mounted
 * before it and guarded by the same CRON_SECRET bearer. Encrypts any plaintext
 * rows in integration_configs / team_integrations in place after
 * CONFIG_ENCRYPTION_KEY is set in production. Idempotent (skips already-encrypted
 * rows) and safe to re-run; no-ops when the key is unset.
 */
async function encryptConfigsHandler(req: Request, res: Response): Promise<void> {
  if (!authorized(req.header("authorization"))) {
    res.sendStatus(401);
    return;
  }
  const result = await backfillEncryption();
  logger.info(result, "Credential encryption backfill complete");
  res.json(result);
}

router.get("/internal/encrypt-configs", encryptConfigsHandler);
router.post("/internal/encrypt-configs", encryptConfigsHandler);

/**
 * Graphify microservice callback (spec Phase 2). Not behind requireAuth —
 * mounted before it and guarded by the shared GRAPHIFY_SERVICE_SECRET. The
 * microservice POSTs the built graph (or an error) for a repo_id when indexing
 * finishes.
 */
router.post("/internal/graphify-callback", async (req: Request, res: Response): Promise<void> => {
  const secret = req.header("x-service-secret");
  if (!process.env.GRAPHIFY_SERVICE_SECRET || secret !== process.env.GRAPHIFY_SERVICE_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { repo_id, graph, error } = (req.body ?? {}) as {
    repo_id?: number;
    graph?: { nodes?: unknown[] } | null;
    error?: string | null;
  };
  const repoId = Number(repo_id);
  if (!Number.isFinite(repoId)) {
    res.status(400).json({ error: "Invalid repo_id" });
    return;
  }

  if (error || !graph) {
    logger.warn({ repoId, error }, "Graphify indexing failed");
    // Record the failure with its error text so the UI can surface it (0021).
    await db
      .update(repositoriesTable)
      .set({
        graphStatus: "failed",
        graphError: typeof error === "string" ? error.slice(0, 1000) : "Indexing failed.",
      })
      .where(eq(repositoriesTable.id, repoId));
    res.status(200).json({ received: true });
    return;
  }

  const nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  await db
    .update(repositoriesTable)
    .set({
      graphJson: graph as typeof repositoriesTable.$inferInsert.graphJson,
      graphBuiltAt: new Date(),
      graphNodeCount: nodeCount,
      graphStatus: "succeeded",
      graphError: null,
    })
    .where(eq(repositoriesTable.id, repoId));

  logger.info({ repoId, nodes: nodeCount }, "Graph stored");
  res.status(200).json({ received: true, nodes: nodeCount });
});

export default router;
