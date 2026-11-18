import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  reviewScansTable,
  reviewFindingsTable,
  type ReviewScan,
  type ReviewFinding,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { RunError } from "./runService.js";
import { resolveModelKey, noModelKeyMessage } from "./modelKey.js";
import { resolveGitCreds } from "./gitToken.js";
import { GitService } from "./gitService.js";
import { canAdminister } from "./resourceAdmin.js";
import * as audit from "./auditService.js";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";
import { actualCostUsd } from "./baselineScanCore.js";
import {
  discoverFiles,
  loadTarget,
  mapWithConcurrency,
  submitWithRetentionFallback,
  type ScanTarget,
} from "./baselineScanService.js";
import {
  estimateReview,
  parseReviewFile,
  reviewFilePrompt,
  reviewFingerprint,
  sortReviewFindings,
  MAX_FILE_CHARS,
  MAX_FILES,
  type ReviewEstimate,
} from "./reviewScanCore.js";

/**
 * The whole-repository code review (0051).
 *
 * The lifecycle is the baseline security scan's, because that lifecycle is
 * about surviving a 300-second serverless function and nothing else: discover
 * the files, freeze the list, submit ONE Message Batch, return, and let the
 * cron dispatcher collect it minutes later. The machinery is imported rather
 * than copied; the prompt, the taxonomy and the tables are this review's own.
 *
 * Nothing here gates anything. A review reports what a reviewer would raise;
 * it blocks no merge, files no ticket and fails no run.
 */

/** Parallel reads while starting a review. Matches the security scan's ceiling. */
const FETCH_CONCURRENCY = 8;
/** Above this, starting is slow enough that an operator should see why. */
const TARBALL_THRESHOLD = 1_000;

export interface ReviewActor {
  userId: string;
  teamId: number | null;
  teamRole: string | null;
}

/**
 * Whether this actor may start a review of this repository.
 *
 * The same rule as the baseline scan, and for the same reason: it spends the
 * workspace's model credentials on every file in a customer's codebase. The
 * single place the feature is gated, so a plan entitlement later lands here
 * and nowhere else.
 */
export function canRunReview(
  actor: ReviewActor,
  target: ScanTarget,
): { allowed: boolean; reason: string | null } {
  const owner = target.project?.userId ?? target.repo.userId;
  const teamId = target.project?.teamId ?? null;
  if (!canAdminister(actor, { ownerUserId: owner, teamId })) {
    return {
      allowed: false,
      reason:
        teamId != null
          ? "Only an admin of this project's team can start a code review."
          : "Only the owner of this repository can start a code review.",
    };
  }
  if (!target.repo.url) {
    return { allowed: false, reason: "This repository needs a valid URL before it can be reviewed." };
  }
  return { allowed: true, reason: null };
}

/**
 * Whether this actor may SEE a repository's reviews.
 *
 * Wider than starting one and narrower than "authenticated": findings name
 * file paths and describe defects in a specific codebase, so the rule is the
 * owner or a member of the team whose project owns the repository, exactly as
 * for the security scan and `GET /runs/:id`.
 */
export function canViewReviews(actor: ReviewActor, target: ScanTarget): boolean {
  if (target.repo.userId === actor.userId) return true;
  const teamId = target.project?.teamId ?? null;
  return teamId != null && actor.teamId === teamId;
}

export async function loadReviewTarget(repositoryId: number, actor: ReviewActor) {
  const target = await loadTarget(repositoryId);
  return { target, canView: canViewReviews(actor, target), gate: canRunReview(actor, target) };
}

/** A one-line stack description for the prompt; the profile shape is loose by design. */
function describeStackProfile(profile: unknown): string | undefined {
  const p = profile as { language?: string; framework?: string } | null;
  if (!p) return undefined;
  return [p.language, p.framework].filter(Boolean).join(" / ") || undefined;
}

/** The file list and what it would cost, before any spend begins. */
export async function estimateForRepository(
  repositoryId: number,
  userId: string,
  pathPrefix: string | null = null,
): Promise<ReviewEstimate> {
  const { repo } = await loadTarget(repositoryId);
  if (!repo.url) throw new RunError("This repository needs a valid URL before it can be reviewed.", 400);

  const graph = repo.graphStatus === "succeeded" ? (repo.graphJson as GraphifyGraph | null) : null;
  let treePaths: string[] = [];
  if (!graph) {
    const creds = await resolveGitCreds(userId);
    const git = await GitService.forRepo(repo.id, { githubToken: creds.githubToken });
    treePaths = await git.fetchFilePaths();
  }
  // The same discovery as the security scan: a built graph is a parser's
  // output, so it already excludes docs, config and anything unparseable, and
  // the extension filter is the fallback. Reviewing a different file set than
  // the scan would make the two incomparable for no benefit.
  const { paths, source } = discoverFiles(graph, treePaths, pathPrefix);
  return { ...estimateReview(paths.length), source, pathPrefix };
}

/**
 * Submit the review as one Message Batch and record it as `scanning`.
 *
 * Returns as soon as the batch is accepted. Nothing here waits for results,
 * which is the point: the work outlives the request that started it.
 */
export async function startReview(
  repositoryId: number,
  actor: ReviewActor,
  pathPrefix: string | null = null,
): Promise<ReviewScan> {
  const target = await loadTarget(repositoryId);
  const gate = canRunReview(actor, target);
  if (!gate.allowed) throw new RunError(gate.reason!, 403);

  const [active] = await db
    .select()
    .from(reviewScansTable)
    .where(
      and(
        eq(reviewScansTable.repositoryId, repositoryId),
        inArray(reviewScansTable.status, ["queued", "scanning"]),
      ),
    );
  if (active) throw new RunError("A code review is already running for this repository.", 409);

  const creds = await resolveGitCreds(actor.userId);
  const agentKey = await resolveModelKey(actor.userId, "anthropic");
  if (!agentKey.key) throw new RunError(noModelKeyMessage(actor.teamRole === "admin"), 424);

  const repo = target.repo;
  const graph = repo.graphStatus === "succeeded" ? (repo.graphJson as GraphifyGraph | null) : null;
  const git = await GitService.forRepo(repo.id, { githubToken: creds.githubToken });
  const treePaths = graph ? [] : await git.fetchFilePaths();
  const { paths } = discoverFiles(graph, treePaths, pathPrefix);

  if (paths.length === 0) {
    throw new RunError(
      pathPrefix
        ? `No reviewable source files were found under "${pathPrefix}". Check the folder path.`
        : "No reviewable source files were found in this repository.",
      422,
    );
  }
  if (paths.length > MAX_FILES) {
    throw new RunError(
      pathPrefix
        ? `"${pathPrefix}" has ${paths.length} reviewable files, above the ${MAX_FILES}-file limit for one review. Choose a folder inside it.`
        : `This repository has ${paths.length} reviewable files, above the ${MAX_FILES}-file limit for a code review. Review a folder at a time instead.`,
      422,
    );
  }
  if (paths.length > TARBALL_THRESHOLD) {
    logger.warn({ repositoryId, files: paths.length }, "Code review is fetching >1000 files one call at a time");
  }

  const estimate = estimateReview(paths.length);
  const [scan] = await db
    .insert(reviewScansTable)
    .values({
      repositoryId,
      projectId: repo.projectId ?? null,
      teamId: target.project?.teamId ?? actor.teamId ?? null,
      triggeredBy: actor.userId,
      status: "queued",
      filesTotal: paths.length,
      // Frozen here and read verbatim at collection: custom_id `f<i>` indexes
      // into THIS array, so a push mid-review cannot slide a different file
      // into slot i. The lesson 0036 paid for on the security scan.
      filePaths: paths,
      pathPrefix,
      estimatedCostUsd: String(estimate.estimatedCostUsd),
      startedAt: new Date(),
    })
    .returning();

  try {
    const stackDesc = describeStackProfile(repo.stackProfile);
    const contents = await mapWithConcurrency(paths, FETCH_CONCURRENCY, async (filePath) => {
      try {
        return (await git.fetchFileWithSha(filePath))?.content ?? "";
      } catch {
        return "";
      }
    });

    const requests: { custom_id: string; params: Anthropic.Messages.MessageCreateParamsNonStreaming }[] = [];
    let skipped = 0;
    for (const [i, filePath] of paths.entries()) {
      const code = contents[i];
      if (!code.trim()) {
        // Unreadable, deleted between tree and fetch, or over the provider's
        // content ceiling. An empty file submitted is not a clean review.
        skipped++;
        continue;
      }
      requests.push({
        custom_id: `f${i}`,
        params: {
          // Overridden per attempt by the retention fallback below.
          model: "placeholder",
          max_tokens: 2000,
          messages: [
            { role: "user", content: reviewFilePrompt({ filePath, code: code.slice(0, MAX_FILE_CHARS) }, stackDesc) },
          ],
        },
      });
    }

    if (requests.length === 0) throw new RunError("None of this repository's files could be read.", 422);

    const client = new Anthropic({ apiKey: agentKey.key });
    const { batch, model } = await submitWithRetentionFallback(
      (m) =>
        client.messages.batches.create({
          requests: requests.map((r) => ({ ...r, params: { ...r.params, model: m } })),
        }),
      { scanId: scan.id, kind: "Code review" },
    );

    const [updated] = await db
      .update(reviewScansTable)
      .set({ status: "scanning", batchId: batch.id, filesSkipped: skipped, model })
      .where(eq(reviewScansTable.id, scan.id))
      .returning();
    logger.info(
      { scanId: scan.id, batchId: batch.id, agent: "veria", model, files: requests.length, skipped },
      "Code review batch submitted",
    );
    return updated;
  } catch (err) {
    await db
      .update(reviewScansTable)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 500) : "Batch submission failed",
        finishedAt: new Date(),
      })
      .where(eq(reviewScansTable.id, scan.id));
    throw err;
  }
}

async function failReview(scanId: number, message: string): Promise<void> {
  await db
    .update(reviewScansTable)
    .set({ status: "failed", error: message.slice(0, 500), finishedAt: new Date() })
    .where(eq(reviewScansTable.id, scanId));
}

/**
 * Carry a human decision forward into a later review.
 *
 * Matched on the fingerprint, which excludes the line number, so a finding a
 * team has already dismissed with a reason does not come back as new because
 * someone added an import above it. Without this, the second review of any
 * repository is unreadable. Copied in behaviour from the security scan's
 * equivalent, deliberately: a team learns one rule, not two.
 */
export async function carryForwardAcknowledgements(scan: ReviewScan): Promise<void> {
  const priorScans = await db
    .select({ id: reviewScansTable.id })
    .from(reviewScansTable)
    .where(and(eq(reviewScansTable.repositoryId, scan.repositoryId), eq(reviewScansTable.status, "succeeded")));
  const priorIds = priorScans.map((s) => s.id).filter((id) => id !== scan.id);
  if (priorIds.length === 0) return;

  const acked = await db
    .select()
    .from(reviewFindingsTable)
    .where(and(inArray(reviewFindingsTable.scanId, priorIds), eq(reviewFindingsTable.status, "acknowledged")));
  if (acked.length === 0) return;

  // Newest acknowledgement wins where the same finding was triaged twice.
  const byFingerprint = new Map<string, ReviewFinding>();
  for (const f of acked.sort((a, b) => a.id - b.id)) byFingerprint.set(f.fingerprint, f);

  const fresh = await db
    .select()
    .from(reviewFindingsTable)
    .where(and(eq(reviewFindingsTable.scanId, scan.id), eq(reviewFindingsTable.status, "open")));

  let carried = 0;
  for (const f of fresh) {
    const prior = byFingerprint.get(f.fingerprint);
    if (!prior) continue;
    await db
      .update(reviewFindingsTable)
      .set({
        status: "acknowledged",
        acknowledgedBy: prior.acknowledgedBy,
        acknowledgedAt: prior.acknowledgedAt,
        acknowledgeReason: prior.acknowledgeReason,
      })
      .where(eq(reviewFindingsTable.id, f.id));
    carried++;
  }
  if (carried > 0) logger.info({ scanId: scan.id, carried }, "Review acknowledgements carried forward");
}

/**
 * Poll one in-flight review's batch and, if it has ended, persist its findings.
 *
 * Returns true when the review reached a terminal state on this pass. Never
 * throws: a review that cannot be collected is marked failed rather than
 * polled for ever.
 */
export async function collectReview(scan: ReviewScan): Promise<boolean> {
  if (!scan.batchId) {
    await failReview(scan.id, "Review has no batch to collect.");
    return true;
  }
  try {
    // Collection runs long after the start, so the key is resolved again
    // through the user who triggered it rather than cached across invocations.
    const key = await resolveModelKey(scan.triggeredBy, "anthropic");
    if (!key.key) {
      await failReview(scan.id, "The credentials that started this review are no longer available.");
      return true;
    }
    const client = new Anthropic({ apiKey: key.key });
    const batch = await client.messages.batches.retrieve(scan.batchId);
    if (batch.processing_status !== "ended") return false;

    const paths = scan.filePaths ?? [];
    if (paths.length === 0) {
      await failReview(scan.id, "This review has no stored file list and cannot be collected safely.");
      return true;
    }

    const rows: (typeof reviewFindingsTable.$inferInsert)[] = [];
    let reviewed = 0;
    let errored = 0;
    // Counted for every result the provider returned, the unparseable ones
    // included: those requests were charged for, and omitting them
    // under-reports the spend.
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const result of await client.messages.batches.results(scan.batchId)) {
      const idx = Number(result.custom_id.slice(1));
      const filePath = paths[idx];
      if (filePath == null) continue;
      if (result.result.type !== "succeeded") {
        errored++;
        continue;
      }
      const usage = result.result.message.usage;
      inputTokens += usage?.input_tokens ?? 0;
      outputTokens += usage?.output_tokens ?? 0;
      const raw = result.result.message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("")
        .trim();
      try {
        const findings = parseReviewFile(raw);
        reviewed++;
        for (const f of findings) {
          rows.push({
            scanId: scan.id,
            severity: f.severity,
            category: f.category,
            // From the frozen list, never from the reply: a model naming
            // another file must not be able to misattribute a finding.
            filePath,
            title: f.title,
            detail: f.detail,
            lineRef: f.lineRef,
            remediation: f.remediation,
            fingerprint: reviewFingerprint(filePath, f.title, f.category),
          });
        }
      } catch {
        // A file whose reply will not parse is an UNREVIEWED file, not a clean
        // one, and the coverage figure has to say so.
        errored++;
      }
    }

    if (rows.length > 0) await db.insert(reviewFindingsTable).values(rows);
    await carryForwardAcknowledgements(scan);

    const counts = { high: 0, medium: 0, low: 0 };
    for (const r of rows) if (r.severity in counts) counts[r.severity as keyof typeof counts]++;

    await db
      .update(reviewScansTable)
      .set({
        status: "succeeded",
        filesReviewed: reviewed,
        filesSkipped: (scan.filesSkipped ?? 0) + errored,
        highCount: counts.high,
        mediumCount: counts.medium,
        lowCount: counts.low,
        inputTokens,
        outputTokens,
        actualCostUsd: (() => {
          const cost = actualCostUsd(scan.model, inputTokens, outputTokens);
          return cost == null ? null : String(cost);
        })(),
        finishedAt: new Date(),
      })
      .where(eq(reviewScansTable.id, scan.id));

    // Attributed to whoever started it: the collector is a cron tick with no
    // actor of its own, and the audit trail should name a person.
    audit.log({
      userId: scan.triggeredBy,
      teamId: scan.teamId,
      action: "review.scan_completed",
      entityType: "review_scan",
      entityId: scan.id,
      metadata: {
        repositoryId: scan.repositoryId,
        projectId: scan.projectId,
        filesTotal: scan.filesTotal,
        filesReviewed: reviewed,
        filesSkipped: (scan.filesSkipped ?? 0) + errored,
        highCount: counts.high,
        mediumCount: counts.medium,
        lowCount: counts.low,
        inputTokens,
        outputTokens,
        actualCostUsd: actualCostUsd(scan.model, inputTokens, outputTokens),
        model: scan.model,
        pathPrefix: scan.pathPrefix,
      },
    });
    logger.info({ scanId: scan.id, reviewed, errored, findings: rows.length }, "Code review collected");
    return true;
  } catch (err) {
    logger.warn({ scanId: scan.id, err }, "Code review collection failed");
    await failReview(scan.id, err instanceof Error ? err.message : "Collection failed.");
    return true;
  }
}

/** In-flight reviews the dispatcher should poll. */
export async function listReviewsAwaitingCollection(limit = 5): Promise<ReviewScan[]> {
  return db
    .select()
    .from(reviewScansTable)
    .where(eq(reviewScansTable.status, "scanning"))
    .orderBy(reviewScansTable.startedAt)
    .limit(limit);
}

export async function listReviewsForRepository(repositoryId: number): Promise<ReviewScan[]> {
  return db
    .select()
    .from(reviewScansTable)
    .where(eq(reviewScansTable.repositoryId, repositoryId))
    .orderBy(desc(reviewScansTable.id));
}

export async function getReviewWithFindings(
  scanId: number,
): Promise<{ scan: ReviewScan; findings: ReviewFinding[] } | null> {
  const [scan] = await db.select().from(reviewScansTable).where(eq(reviewScansTable.id, scanId));
  if (!scan) return null;
  const findings = await db
    .select()
    .from(reviewFindingsTable)
    .where(eq(reviewFindingsTable.scanId, scanId));
  return { scan, findings: sortReviewFindings(findings) };
}

/**
 * Dismiss a finding, with a reason.
 *
 * The reason is mandatory and enforced by a database CHECK as well as here: a
 * dismissal with no stated reason is indistinguishable from a finding nobody
 * looked at, and it is carried forward silently into every later review.
 */
export async function acknowledgeFinding(
  findingId: number,
  actorUserId: string,
  reason: string,
): Promise<ReviewFinding | null> {
  const trimmed = reason.trim();
  if (!trimmed) throw new RunError("A reason is required to dismiss a finding.", 400);
  const [updated] = await db
    .update(reviewFindingsTable)
    .set({
      status: "acknowledged",
      acknowledgedBy: actorUserId,
      acknowledgedAt: new Date(),
      acknowledgeReason: trimmed.slice(0, 1_000),
    })
    .where(eq(reviewFindingsTable.id, findingId))
    .returning();
  return updated ?? null;
}

/** The scan a finding belongs to, for the authorization check on triage. */
export async function findingScan(findingId: number): Promise<ReviewScan | null> {
  const [finding] = await db
    .select({ scanId: reviewFindingsTable.scanId })
    .from(reviewFindingsTable)
    .where(eq(reviewFindingsTable.id, findingId));
  if (!finding) return null;
  const [scan] = await db.select().from(reviewScansTable).where(eq(reviewScansTable.id, finding.scanId));
  return scan ?? null;
}
