import { Router, type IRouter, type Request, type Response } from "express";
import { sql, eq } from "drizzle-orm";
import { db, repositoriesTable } from "@workspace/db";
import { executeRun } from "../services/runService.js";
import { holdIfOrderChanged } from "../services/sequenceGate.js";
import { dispatchPendingProfiles } from "../services/uiStyleService.js";
import { runJiraRetention } from "../services/jiraExt/installations.js";
import { dispatchQueuedIndexes } from "../services/graphifyService.js";
import { dispatchPendingSetups } from "../services/repoSetup.js";
import { dispatchQueuedExtractions } from "../services/domainExtractService.js";
import { collectReview, listReviewsAwaitingCollection } from "../services/reviewScanService.js";
import { listScansAwaitingCollection, collectBaselineScan } from "../services/baselineScanService.js";
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
 * How long a MANUAL run may sit `queued` before it is presumed abandoned. The
 * client creates it and then fires POST /runs/:id/execute without awaiting, so
 * the only way to stay queued this long is for that second request never to
 * have arrived.
 */
const STRANDED_MANUAL_MINUTES = 10;
/**
 * How long a baseline scan may sit in `queued` before it is presumed dead.
 * Starting one is capped at the function's own 300s ceiling, so ten minutes is
 * comfortably past any legitimate start.
 */
const BASELINE_STUCK_MINUTES = 10;

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
 * and guarded by CRON_SECRET. Steps 3 and 4 are the baseline scan's only
 * execution surface, since a scan cannot fit in one function invocation, and
 * steps 5 to 8 are additive: each records its own failures and none may delay
 * the run dispatch above it.
 *   1. Sweep stuck `running` rows (>20 min) to `failed`.
 *   1b. Fail manual runs stranded in `queued` with no execution.
 *   2. Claim up to DISPATCH_BATCH due `scheduled` rows with FOR UPDATE SKIP
 *      LOCKED so concurrent ticks never grab the same run, flip them to
 *      `queued`, and execute each inline.
 *   3. Sweep baseline scans stuck in `queued` (start died before submitting).
 *   4. Collect baseline scans whose Message Batch has ended.
 *   4b. The same sweep and collection for code reviews (0051).
 *   5. Extract UI style profiles waiting to be read (0042).
 *   6. Jira app retention (0043).
 *   7. Start graph indexes waiting in `queued` (0048).
 *   8. Act on connect-time setup choices still outstanding (0048).
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

  // 1b. Stranded manual runs (0044 PR3). A manual run is now created `queued`
  // and executed by a separate request the client fires without awaiting, so a
  // tab closed in the gap between the two leaves a row nobody will ever
  // execute — and the sweep above only looks at `running`. A manual run is
  // created and executed within seconds, so `created_at` is a safe clock here.
  //
  // Deliberately scoped to `trigger = 'manual'`: a scheduled run also passes
  // through `queued` (this dispatcher claims it, then runs it in the same
  // invocation), but its `created_at` can be thirty days old, so the same
  // predicate would reap one that was claimed a second ago. A scheduled run
  // stranded by an invocation that died mid-claim is a separate, pre-existing
  // gap, recorded in CLAUDE.md §14 rather than papered over here.
  //
  // `started_at IS NULL` is what makes `created_at` a safe clock, and it is the
  // whole case this sweep is for: a run that was never executed at all. The two
  // human-in-the-loop exits (approve a parked plan, regenerate a revised one)
  // also park the row in `queued` for a client-fired start, but their
  // `created_at` is as old as the run — without this clause the predicate is
  // already true the instant they queue, and a cron tick landing in the second
  // before the client's call would fail a run that is about to start. Those
  // rows have run before, so `started_at` is set and they are excluded.
  const strandedManual = await db.execute(
    sql`UPDATE runs SET status = 'failed', finished_at = now(),
          error = 'Run was never started (the browser closed before execution began). Run it again.'
        WHERE status = 'queued'
          AND trigger = 'manual'
          AND started_at IS NULL
          AND created_at < now() - interval '${sql.raw(String(STRANDED_MANUAL_MINUTES))} minutes'
        RETURNING id`,
  );
  const strandedCount = strandedManual.rows.length;

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

  if (sweptCount > 0 || strandedCount > 0 || ids.length > 0) {
    logger.info({ swept: sweptCount, stranded: strandedCount, claimed: ids }, "dispatch-runs tick");
  }

  // Execute claimed runs sequentially — each executeRun never throws (it records
  // failure on the row), so one bad run can't abort the batch.
  //
  // The run-order re-check happens here rather than at scheduling time: the gap
  // between the two is exactly where a new blocker appears, and a run nobody is
  // watching should not start into an order its owner never agreed to (0038).
  let held = 0;
  for (const id of ids) {
    if (await holdIfOrderChanged(id)) {
      held++;
      continue;
    }
    await executeRun(id);
  }

  // 3. Sweep baseline scans stuck in `queued`.
  //
  // A scan is inserted `queued`, then flipped to `scanning` once its batch is
  // accepted. If the function is killed in between — the file-fetch loop
  // against a large repository is the realistic way that happens — the row
  // stays `queued`: nothing collects it, because collection only looks at
  // `scanning`, and every retry is refused by the duplicate check, which
  // treats `queued` as active. The repository becomes permanently
  // un-scannable. The start path is itself capped at 300s, so anything still
  // `queued` after this long is dead, not slow.
  const sweptScans = await db.execute(
    sql`UPDATE baseline_scans SET status = 'failed', finished_at = now(),
          error = 'Scan did not finish starting (no batch was submitted within ${sql.raw(String(BASELINE_STUCK_MINUTES))} minutes). Start it again.'
        WHERE status = 'queued'
          AND created_at < now() - interval '${sql.raw(String(BASELINE_STUCK_MINUTES))} minutes'
        RETURNING id`,
  );
  const sweptScanCount = sweptScans.rows.length;
  if (sweptScanCount > 0) {
    logger.warn({ swept: sweptScanCount }, "baseline scans swept from queued to failed");
  }

  // 4. Collect finished baseline scans (0035). A baseline scan runs as an
  // Anthropic Message Batch precisely because it cannot fit in a 300s function;
  // this tick is what notices the batch has ended. Polling is cheap — a
  // retrieve per in-flight scan — and collectBaselineScan never throws, so a
  // scan that cannot be collected is marked failed rather than polled forever.
  let collected = 0;
  const pending = await listScansAwaitingCollection();
  for (const scan of pending) {
    if (await collectBaselineScan(scan)) collected++;
  }
  if (pending.length > 0) {
    logger.info({ pending: pending.length, collected }, "baseline scan collection tick");
  }

  // 4b. The code review's sweep and collector (0051).
  //
  // Same two steps as 3 and 4 above, on its own tables. A review is one
  // Message Batch for exactly the reason a security scan is: it cannot fit in
  // one function invocation. A row left `queued` means the start died before
  // submitting, and nothing else would ever look at it, because collection
  // only polls `scanning` and every retry is refused by the duplicate check.
  const sweptReviews = await db.execute(
    sql`UPDATE review_scans SET status = 'failed', finished_at = now(),
          error = 'Review did not finish starting (no batch was submitted within ${sql.raw(String(BASELINE_STUCK_MINUTES))} minutes). Start it again.'
        WHERE status = 'queued'
          AND created_at < now() - interval '${sql.raw(String(BASELINE_STUCK_MINUTES))} minutes'
        RETURNING id`,
  );
  if (sweptReviews.rows.length > 0) {
    logger.warn({ swept: sweptReviews.rows.length }, "code reviews swept from queued to failed");
  }

  let reviewsCollected = 0;
  const pendingReviews = await listReviewsAwaitingCollection();
  for (const scan of pendingReviews) {
    if (await collectReview(scan)) reviewsCollected++;
  }
  if (pendingReviews.length > 0) {
    logger.info({ pending: pendingReviews.length, collected: reviewsCollected }, "code review collection tick");
  }

  // 5. Extract UI style profiles that are waiting (0042).
  //
  // Last and additive on purpose: a project-creation insert or a repository
  // rebind queues a row, and this is what picks it up when nobody opens the
  // settings page. It runs AFTER the run dispatch so a slow repository read
  // can never delay a scheduled run, and dispatchPendingProfiles records its
  // own failures on the row rather than throwing.
  let profiles: number[] = [];
  try {
    profiles = await dispatchPendingProfiles();
    if (profiles.length > 0) logger.info({ profiles }, "ui style extraction tick");
  } catch (err) {
    logger.warn({ err }, "UI style extraction tick failed");
  }

  // 6. Jira app retention (0043): an installation disabled longer than the
  // window loses its account links and unused codes. Additive and last, like
  // step 5, and its own failure is never the dispatcher's.
  let jiraRetention = { installations: 0, links: 0, codes: 0 };
  try {
    jiraRetention = await runJiraRetention();
    if (jiraRetention.installations > 0) logger.info({ ...jiraRetention }, "jira retention tick");
  } catch (err) {
    logger.warn({ err }, "Jira retention tick failed");
  }

  // 7. Start indexes waiting in `queued` (0048).
  //
  // A repository parks there when the handoff to the Graphify microservice
  // could not be made — it was unreachable, or it refused — and when a commit
  // queues a re-index rather than paying for the handoff inside the response
  // the committer is waiting on. Before this, the request that asked for an
  // index was the only chance it ever got: the handoff was `void fetch(...)`,
  // so on @vercel/node it could be frozen before leaving, and the row sat
  // reading `indexing` for an index that never started.
  //
  // Additive and after the run dispatch, like steps 5 and 6, so a slow
  // microservice can never delay a scheduled run.
  let indexesStarted: number[] = [];
  try {
    indexesStarted = await dispatchQueuedIndexes();
    if (indexesStarted.length > 0) logger.info({ indexesStarted }, "graph index dispatch tick");
  } catch (err) {
    logger.warn({ err }, "Graph index dispatch tick failed");
  }

  // 8. Act on connect-time setup choices that are still outstanding (0048).
  //
  // Only `index_scan` reaches here: a baseline scan reads every source file,
  // submits a Message Batch and is collected minutes later by step 4 of this
  // same tick, so it cannot be started from the connect request. It waits for
  // the index to settle first, because the scan's file discovery prefers a
  // built graph over the raw tree.
  //
  // Last, for the same reason as the two steps above.
  let setupsActed: number[] = [];
  try {
    setupsActed = await dispatchPendingSetups();
    if (setupsActed.length > 0) logger.info({ setupsActed }, "repository setup tick");
  } catch (err) {
    logger.warn({ err }, "Repository setup tick failed");
  }

  // 9. Run one queued domain extraction (0052, PR 2b).
  //
  // One per tick, and last. An extraction is a single large model call on the
  // project owner's own key, so a tick that started several at once would
  // turn one sweep into several simultaneous charges. Nothing waits on the
  // result: the rules it writes are `proposed`, and the review queue that
  // reads them is a later PR.
  let extractionsStarted = 0;
  try {
    extractionsStarted = await dispatchQueuedExtractions();
    if (extractionsStarted > 0) logger.info({ extractionsStarted }, "domain extraction tick");
  } catch (err) {
    logger.warn({ err }, "Domain extraction tick failed");
  }

  res.json({
    swept: sweptCount,
    dispatched: ids.length - held,
    held,
    baselineSwept: sweptScanCount,
    baselinePending: pending.length,
    baselineCollected: collected,
    extractionsStarted,
    reviewsSwept: sweptReviews.rows.length,
    reviewsPending: pendingReviews.length,
    reviewsCollected,
    uiStyleExtracted: profiles.length,
    jiraLinksRevoked: jiraRetention.links,
    indexesStarted: indexesStarted.length,
    setupsActed: setupsActed.length,
  });
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
