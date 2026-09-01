import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  baselineScansTable,
  baselineFindingsTable,
  repositoriesTable,
  projectsTable,
  type BaselineScan,
  type BaselineFinding,
} from "@workspace/db";
import { GitService } from "./gitService.js";
import { getConfigs } from "./configService.js";
import { baselineFilePrompt, parseFileScan } from "./aegisService.js";
import { canAdminister } from "./resourceAdmin.js";
import { RunError } from "./runService.js";
import * as audit from "./auditService.js";
import { logger } from "../lib/logger.js";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";
import { discoverFiles, estimateScan, findingFingerprint, sortFindings, MAX_FILE_CHARS, MAX_FILES, type BaselineEstimate } from "./baselineScanCore.js";

// Re-exported so existing callers keep importing from the service; the pure
// core lives in its own module only so it can be tested without a database.
export { discoverFiles, estimateScan, findingFingerprint, sortFindings, MAX_FILES };
export type { BaselineEstimate };

/**
 * Baseline security scan — Aegis pointed at a codebase that already exists.
 *
 * Three things make this structurally different from the runtime scan, and all
 * three are load-bearing:
 *
 *  1. **No gate.** Nothing is being merged, so there is nothing to block.
 *     `runAegisScan` computes a fail-closed `gateDecision` and would report
 *     "blocked" on essentially every baseline run — a few timeouts across
 *     hundreds of files is normal. That value never reaches the database;
 *     coverage counts replace it.
 *  2. **The Batches API, not live requests.** A serverless function is capped
 *     at 300s and a real repository takes tens of minutes. One batch is
 *     submitted here and the cron dispatcher collects it later. It also halves
 *     the price.
 *  3. **Findings are triaged individually**, so they are rows carrying a
 *     fingerprint that survives unrelated edits to their file.
 */

const MODEL = "claude-fable-5";
/**
 * Above this, reading file-by-file is the wrong shape: it eats the hourly
 * GitHub budget that runs and syncs share, and the fetch loop starts pressing
 * against the function's 300s ceiling. The fix is one tarball download instead
 * of N calls; until that lands, a repository this size logs a warning and may
 * time out while starting.
 */
const TARBALL_THRESHOLD = 1_000;

/** Parallel reads while starting a scan. Matches the scanner's own ceiling. */
const FETCH_CONCURRENCY = 8;

/** Bounded-concurrency map preserving input order. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A repository plus the project that owns it, for authorization and PLM context. */
interface ScanTarget {
  repo: typeof repositoriesTable.$inferSelect;
  project: typeof projectsTable.$inferSelect | null;
}

async function loadTarget(repositoryId: number): Promise<ScanTarget> {
  const [repo] = await db.select().from(repositoriesTable).where(eq(repositoriesTable.id, repositoryId));
  if (!repo) throw new RunError("Repository not found", 404);
  const [project] = repo.projectId
    ? await db.select().from(projectsTable).where(eq(projectsTable.id, repo.projectId))
    : [];
  return { repo, project: project ?? null };
}

export interface BaselineActor {
  userId: string;
  teamId: number | null;
  teamRole: string | null;
}

/**
 * Whether this actor may run a baseline scan on this repository.
 *
 * The single place the feature is gated. It is free for every admin today; when
 * plan entitlements arrive the check belongs here and nowhere else, so the UI
 * and every route ask this function rather than testing a role themselves.
 */
export async function canRunBaselineScan(
  actor: BaselineActor,
  target: ScanTarget,
): Promise<{ allowed: boolean; reason: string | null }> {
  const owner = target.project?.userId ?? target.repo.userId;
  const teamId = target.project?.teamId ?? null;
  if (!canAdminister(actor, { ownerUserId: owner, teamId })) {
    return {
      allowed: false,
      reason:
        teamId != null
          ? "Only an admin of this project's team can start a baseline scan."
          : "Only the owner of this repository can start a baseline scan.",
    };
  }
  if (!target.repo.url) {
    return { allowed: false, reason: "This repository needs a valid URL before it can be scanned." };
  }
  return { allowed: true, reason: null };
}

/**
 * Whether this actor may SEE a repository's scans at all — a separate question
 * from whether they may start one.
 *
 * Same rule as `GET /runs/:id`: the owner, or any member of the team whose
 * project owns the repository. Findings name file paths, vulnerability classes
 * and exploitation detail for a specific codebase, so "authenticated" is
 * nowhere near enough to read them.
 */
export function canViewBaselineScans(actor: BaselineActor, target: ScanTarget): boolean {
  if (target.repo.userId === actor.userId) return true;
  const teamId = target.project?.teamId ?? null;
  return teamId != null && actor.teamId === teamId;
}

/** Resolve the target, who may view it, and who may act on it. */
export async function loadScanTarget(repositoryId: number, actor: BaselineActor) {
  const target = await loadTarget(repositoryId);
  return { target, canView: canViewBaselineScans(actor, target), gate: await canRunBaselineScan(actor, target) };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/** What the admin sees before any spend begins. */
export async function estimateForRepository(repositoryId: number, userId: string): Promise<BaselineEstimate> {
  const { repo } = await loadTarget(repositoryId);
  if (!repo.url) throw new RunError("This repository needs a valid URL before it can be scanned.", 400);

  const graph = repo.graphStatus === "succeeded" ? (repo.graphJson as GraphifyGraph | null) : null;
  let treePaths: string[] = [];
  if (!graph) {
    const creds = await getConfigs(userId, ["GITHUB_TOKEN"]);
    const git = await GitService.forRepo(repo.id, { githubToken: creds.GITHUB_TOKEN });
    treePaths = await git.fetchFilePaths();
  }
  const { paths, source } = discoverFiles(graph, treePaths);
  return { ...estimateScan(paths.length), source };
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/** A one-line stack description for the prompt; the profile shape is loose by design. */
function describeStackProfile(profile: unknown): string | undefined {
  const p = profile as { language?: string; framework?: string } | null;
  if (!p) return undefined;
  return [p.language, p.framework].filter(Boolean).join(" / ") || undefined;
}

/**
 * Submit the scan as one Message Batch and record it as `scanning`.
 *
 * Returns as soon as the batch is accepted. Nothing here waits for results,
 * which is the whole point: the work outlives the request that started it.
 */
export async function startBaselineScan(repositoryId: number, actor: BaselineActor): Promise<BaselineScan> {
  const target = await loadTarget(repositoryId);
  const gate = await canRunBaselineScan(actor, target);
  if (!gate.allowed) throw new RunError(gate.reason!, 403);

  const [active] = await db
    .select()
    .from(baselineScansTable)
    .where(
      and(
        eq(baselineScansTable.repositoryId, repositoryId),
        inArray(baselineScansTable.status, ["queued", "scanning"]),
      ),
    );
  if (active) throw new RunError("A baseline scan is already running for this repository.", 409);

  const creds = await getConfigs(actor.userId, ["ANTHROPIC_API_KEY", "GITHUB_TOKEN"]);
  if (!creds.ANTHROPIC_API_KEY) {
    throw new RunError("Add your Anthropic API key in Integrations to run a baseline scan.", 424);
  }

  const repo = target.repo;
  const graph = repo.graphStatus === "succeeded" ? (repo.graphJson as GraphifyGraph | null) : null;
  const git = await GitService.forRepo(repo.id, { githubToken: creds.GITHUB_TOKEN });
  const treePaths = graph ? [] : await git.fetchFilePaths();
  const { paths } = discoverFiles(graph, treePaths);

  if (paths.length === 0) throw new RunError("No scannable source files were found in this repository.", 422);
  if (paths.length > MAX_FILES) {
    throw new RunError(
      `This repository has ${paths.length} scannable files, above the ${MAX_FILES}-file limit for a baseline scan.`,
      422,
    );
  }
  if (paths.length > TARBALL_THRESHOLD) {
    // Not fatal, but the operator should know why starting is slow and why the
    // GitHub budget dipped. Switching to the tarball is the follow-up.
    logger.warn({ repositoryId, files: paths.length }, "Baseline scan is fetching >1000 files one call at a time");
  }

  const estimate = estimateScan(paths.length);
  const [scan] = await db
    .insert(baselineScansTable)
    .values({
      repositoryId,
      projectId: repo.projectId ?? null,
      teamId: target.project?.teamId ?? actor.teamId ?? null,
      triggeredBy: actor.userId,
      status: "queued",
      filesTotal: paths.length,
      estimatedCostUsd: String(estimate.estimatedCostUsd),
      startedAt: new Date(),
    })
    .returning();

  try {
    // Files that cannot be read — deleted between tree and fetch, over GitHub's
    // 1 MB getContent ceiling, or binary — are skipped up front rather than
    // submitted empty. A scan of nothing is not a clean file.
    const stackDesc = describeStackProfile(repo.stackProfile);

    // Fetched concurrently because this loop is the one part of starting a scan
    // that is bounded by the function's 300s ceiling — everything after it is
    // one batch submission. Sequential reads made even a mid-sized repository
    // time out before the batch was ever created.
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
        skipped++;
        continue;
      }
      requests.push({
        // The index, not the path: custom_id has a length limit and a
        // restricted charset that real paths break. It maps back via `paths`.
        custom_id: `f${i}`,
        params: {
          model: MODEL,
          max_tokens: 2000,
          messages: [
            {
              role: "user",
              content: baselineFilePrompt({ filePath, code: code.slice(0, MAX_FILE_CHARS) }, stackDesc),
            },
          ],
        },
      });
    }

    if (requests.length === 0) throw new RunError("None of this repository's files could be read.", 422);

    const client = new Anthropic({ apiKey: creds.ANTHROPIC_API_KEY });
    const batch = await client.messages.batches.create({ requests });

    const [updated] = await db
      .update(baselineScansTable)
      .set({ status: "scanning", batchId: batch.id, filesSkipped: skipped })
      .where(eq(baselineScansTable.id, scan.id))
      .returning();
    logger.info(
      { scanId: scan.id, batchId: batch.id, files: requests.length, skipped },
      "Baseline scan batch submitted",
    );
    return updated;
  } catch (err) {
    await db
      .update(baselineScansTable)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 500) : "Batch submission failed",
        finishedAt: new Date(),
      })
      .where(eq(baselineScansTable.id, scan.id));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Collect (driven by the cron dispatcher)
// ---------------------------------------------------------------------------

/**
 * Poll one in-flight scan's batch and, if it has ended, persist its findings.
 *
 * Called from the 5-minute dispatcher. Returns true when the scan reached a
 * terminal state on this pass. Never throws: a scan that cannot be collected is
 * marked failed rather than left to spin.
 */
export async function collectBaselineScan(scan: BaselineScan): Promise<boolean> {
  if (!scan.batchId) {
    await failScan(scan.id, "Scan has no batch to collect.");
    return true;
  }
  try {
    const creds = await getConfigs(scan.triggeredBy, ["ANTHROPIC_API_KEY"]);
    if (!creds.ANTHROPIC_API_KEY) {
      await failScan(scan.id, "The Anthropic API key that started this scan is no longer configured.");
      return true;
    }
    const client = new Anthropic({ apiKey: creds.ANTHROPIC_API_KEY });
    const batch = await client.messages.batches.retrieve(scan.batchId);
    if (batch.processing_status !== "ended") return false;

    // Re-derive the file list exactly as submission did, so custom_id indices
    // resolve to the same paths.
    const { repo } = await loadTarget(scan.repositoryId);
    const graph = repo.graphStatus === "succeeded" ? (repo.graphJson as GraphifyGraph | null) : null;
    let treePaths: string[] = [];
    if (!graph) {
      const gitCreds = await getConfigs(scan.triggeredBy, ["GITHUB_TOKEN"]);
      const git = await GitService.forRepo(repo.id, { githubToken: gitCreds.GITHUB_TOKEN });
      treePaths = await git.fetchFilePaths();
    }
    const { paths } = discoverFiles(graph, treePaths);

    const rows: (typeof baselineFindingsTable.$inferInsert)[] = [];
    let scanned = 0;
    let errored = 0;
    for await (const result of await client.messages.batches.results(scan.batchId)) {
      const idx = Number(result.custom_id.slice(1));
      const filePath = paths[idx];
      if (filePath == null) continue;
      if (result.result.type !== "succeeded") {
        errored++;
        continue;
      }
      const raw = result.result.message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("")
        .trim();
      try {
        const parsed = parseFileScan(raw, filePath);
        scanned++;
        for (const f of parsed.findings) {
          rows.push({
            scanId: scan.id,
            severity: f.severity,
            owasp: f.owasp,
            filePath,
            title: f.title,
            detail: f.detail,
            lineRef: f.lineRef ?? null,
            remediation: f.remediation,
            fingerprint: findingFingerprint(filePath, f.title, f.owasp),
          });
        }
      } catch {
        // A file whose response will not parse is not a clean file — it is an
        // unscanned one, and the coverage figure has to say so.
        errored++;
      }
    }

    if (rows.length > 0) await db.insert(baselineFindingsTable).values(rows);
    await carryForwardAcknowledgements(scan);

    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of rows) if (r.severity in counts) counts[r.severity as keyof typeof counts]++;

    await db
      .update(baselineScansTable)
      .set({
        status: "succeeded",
        filesScanned: scanned,
        // Files the batch could not return join the ones skipped at submission.
        filesSkipped: (scan.filesSkipped ?? 0) + errored,
        criticalCount: counts.critical,
        highCount: counts.high,
        mediumCount: counts.medium,
        lowCount: counts.low,
        finishedAt: new Date(),
      })
      .where(eq(baselineScansTable.id, scan.id));
    // Attributed to whoever started the scan; the collector is a cron tick with
    // no actor of its own, and the audit trail should name a person.
    audit.log({
      userId: scan.triggeredBy,
      teamId: scan.teamId,
      action: "baseline.scan_completed",
      entityType: "baseline_scan",
      entityId: scan.id,
      metadata: {
        repositoryId: scan.repositoryId,
        projectId: scan.projectId,
        filesTotal: scan.filesTotal,
        filesScanned: scanned,
        filesSkipped: (scan.filesSkipped ?? 0) + errored,
        criticalCount: counts.critical,
        highCount: counts.high,
        mediumCount: counts.medium,
        lowCount: counts.low,
      },
    });
    logger.info({ scanId: scan.id, scanned, errored, findings: rows.length }, "Baseline scan collected");
    return true;
  } catch (err) {
    logger.error({ scanId: scan.id, err }, "Baseline scan collection failed");
    await failScan(scan.id, err instanceof Error ? err.message.slice(0, 500) : "Collection failed");
    return true;
  }
}

async function failScan(scanId: number, error: string): Promise<void> {
  await db
    .update(baselineScansTable)
    .set({ status: "failed", error, finishedAt: new Date() })
    .where(eq(baselineScansTable.id, scanId));
}

/** Scans with a batch still in flight, for the dispatcher to poll. */
export async function listScansAwaitingCollection(limit = 5): Promise<BaselineScan[]> {
  return db
    .select()
    .from(baselineScansTable)
    .where(eq(baselineScansTable.status, "scanning"))
    .orderBy(baselineScansTable.startedAt)
    .limit(limit);
}

/**
 * Re-apply acknowledgements from earlier scans of the same repository.
 *
 * Without this a re-scan is worse than useless: it resurfaces every finding the
 * team already triaged, and the new list is indistinguishable from the first.
 * Matching is by fingerprint, so an acknowledgement survives edits that move
 * the finding within its file.
 */
export async function carryForwardAcknowledgements(scan: BaselineScan): Promise<void> {
  const priorScans = await db
    .select({ id: baselineScansTable.id })
    .from(baselineScansTable)
    .where(
      and(eq(baselineScansTable.repositoryId, scan.repositoryId), eq(baselineScansTable.status, "succeeded")),
    );
  const priorIds = priorScans.map((s) => s.id).filter((id) => id !== scan.id);
  if (priorIds.length === 0) return;

  const acked = await db
    .select()
    .from(baselineFindingsTable)
    .where(
      and(inArray(baselineFindingsTable.scanId, priorIds), eq(baselineFindingsTable.status, "acknowledged")),
    );
  if (acked.length === 0) return;

  // Newest acknowledgement wins where the same finding was triaged twice.
  const byFingerprint = new Map<string, BaselineFinding>();
  for (const f of acked.sort((a, b) => a.id - b.id)) byFingerprint.set(f.fingerprint, f);

  const fresh = await db
    .select()
    .from(baselineFindingsTable)
    .where(and(eq(baselineFindingsTable.scanId, scan.id), eq(baselineFindingsTable.status, "open")));

  let carried = 0;
  for (const f of fresh) {
    const prior = byFingerprint.get(f.fingerprint);
    if (!prior) continue;
    await db
      .update(baselineFindingsTable)
      .set({
        status: "acknowledged",
        acknowledgedBy: prior.acknowledgedBy,
        acknowledgedAt: prior.acknowledgedAt,
        acknowledgeReason: prior.acknowledgeReason,
      })
      .where(eq(baselineFindingsTable.id, f.id));
    carried++;
  }
  if (carried > 0) logger.info({ scanId: scan.id, carried }, "Baseline acknowledgements carried forward");
}

// ---------------------------------------------------------------------------
// Reads and triage
// ---------------------------------------------------------------------------

export async function listScansForRepository(repositoryId: number): Promise<BaselineScan[]> {
  return db
    .select()
    .from(baselineScansTable)
    .where(eq(baselineScansTable.repositoryId, repositoryId))
    .orderBy(desc(baselineScansTable.createdAt));
}

export async function getScanWithFindings(
  scanId: number,
): Promise<{ scan: BaselineScan; findings: BaselineFinding[] } | null> {
  const [scan] = await db.select().from(baselineScansTable).where(eq(baselineScansTable.id, scanId));
  if (!scan) return null;
  const findings = await db
    .select()
    .from(baselineFindingsTable)
    .where(eq(baselineFindingsTable.scanId, scanId))
    .orderBy(baselineFindingsTable.id);
  return { scan, findings: sortFindings(findings) };
}

/** Acknowledge a finding. The reason is mandatory and never defaulted. */
export async function acknowledgeFinding(
  findingId: number,
  reason: string,
  actor: BaselineActor,
): Promise<{ finding: BaselineFinding; scan: BaselineScan }> {
  const clean = reason.trim();
  if (!clean) throw new RunError("A reason is required to acknowledge a finding.", 400);

  const [finding] = await db.select().from(baselineFindingsTable).where(eq(baselineFindingsTable.id, findingId));
  if (!finding) throw new RunError("Finding not found", 404);
  const [scan] = await db.select().from(baselineScansTable).where(eq(baselineScansTable.id, finding.scanId));
  if (!scan) throw new RunError("Finding not found", 404);

  const { gate } = await loadScanTarget(scan.repositoryId, actor);
  if (!gate.allowed) throw new RunError(gate.reason!, 403);

  const [updated] = await db
    .update(baselineFindingsTable)
    .set({
      status: "acknowledged",
      acknowledgedBy: actor.userId,
      acknowledgedAt: new Date(),
      acknowledgeReason: clean,
    })
    .where(eq(baselineFindingsTable.id, findingId))
    .returning();
  return { finding: updated, scan };
}

/** Findings selected for the tracker, validated against the scan they belong to. */
export async function loadFindingsForPush(
  scanId: number,
  findingIds: number[],
): Promise<BaselineFinding[]> {
  if (findingIds.length === 0) return [];
  return db
    .select()
    .from(baselineFindingsTable)
    .where(and(eq(baselineFindingsTable.scanId, scanId), inArray(baselineFindingsTable.id, findingIds)));
}

/** Record the tracker ticket a finding was pushed to. */
export async function markFindingPushed(
  findingId: number,
  ticket: { ticketKey: string; ticketUrl: string },
): Promise<void> {
  await db
    .update(baselineFindingsTable)
    .set({ status: "pushed", plmTicketKey: ticket.ticketKey, plmTicketUrl: ticket.ticketUrl })
    .where(eq(baselineFindingsTable.id, findingId));
}
