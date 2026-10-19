import { and, eq, sql } from "drizzle-orm";
import { db, repositoriesTable, uiStyleProfilesTable, type UiStyleProfile } from "@workspace/db";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";
import { GitService } from "./gitService.js";
import { getProjectRepository } from "./repoResolver.js";
import { getConfigs } from "./configService.js";
import { isGraphServable } from "./graphUsability.js";
import { extractUiStyle } from "./uiStyle/extractor.js";
import { logger } from "../lib/logger.js";

/**
 * The database half of the UI style profile (0042): claiming work, running an
 * extraction, and recording the result.
 *
 * Three things can start an extraction — the row inserted at project
 * creation, the cron dispatcher, and the settings page on mount — so the
 * claim is the part that matters. It is a single conditional UPDATE, so two
 * callers racing produce one winner and one no-op rather than two extractions
 * fighting over the same row.
 */

/** A claim older than this is assumed dead and may be taken over. */
export const CLAIM_STALE_MS = 10 * 60 * 1000;
/** A fresh claim is left alone; the caller is told to come back. */
export const CLAIM_FRESH_MS = 5 * 60 * 1000;

export async function getProfile(userId: string, projectId: number): Promise<UiStyleProfile | null> {
  const [row] = await db
    .select()
    .from(uiStyleProfilesTable)
    .where(and(eq(uiStyleProfilesTable.userId, userId), eq(uiStyleProfilesTable.projectId, projectId)));
  return row ?? null;
}

/**
 * Create the pending row for a project. Best-effort: a project must still be
 * created if this fails, and a second call is a no-op rather than a 23505
 * reaching the caller.
 */
export async function ensureProfileRow(userId: string, projectId: number, repositoryId: number | null): Promise<void> {
  try {
    await db
      .insert(uiStyleProfilesTable)
      .values({ userId, projectId, repositoryId, status: "pending" })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err, projectId }, "Could not queue a UI style extraction");
  }
}

/** Mark a project's profile for re-extraction (repository rebind or URL change). */
export async function resetProfile(projectId: number, repositoryId: number | null): Promise<void> {
  try {
    await db
      .update(uiStyleProfilesTable)
      .set({ status: "pending", stale: false, claimedAt: null, error: null, repositoryId })
      .where(eq(uiStyleProfilesTable.projectId, projectId));
  } catch (err) {
    logger.warn({ err, projectId }, "Could not reset the UI style profile");
  }
}

/** Flag a profile as out of date. Fire-and-forget; never fails the caller. */
export function markStale(projectId: number): void {
  db.update(uiStyleProfilesTable)
    .set({ stale: true })
    .where(and(eq(uiStyleProfilesTable.projectId, projectId), eq(uiStyleProfilesTable.status, "ready")))
    .catch((err) => logger.warn({ err, projectId }, "Could not mark the UI style profile stale"));
}

export type ClaimOutcome =
  | { claimed: true; row: UiStyleProfile }
  | { claimed: false; reason: "busy" | "missing"; row: UiStyleProfile | null };

/**
 * Take the row for extraction, or report why not.
 *
 * One UPDATE decides it: the row moves to `extracting` only if it is not
 * already being worked on by someone who claimed it recently. Two concurrent
 * callers therefore cannot both win, without a transaction or a lock table.
 */
export async function claimProfile(projectId: number): Promise<ClaimOutcome> {
  const cutoff = new Date(Date.now() - CLAIM_FRESH_MS);
  const [row] = await db
    .update(uiStyleProfilesTable)
    .set({ status: "extracting", claimedAt: new Date(), error: null })
    .where(
      and(
        eq(uiStyleProfilesTable.projectId, projectId),
        sql`(${uiStyleProfilesTable.status} <> 'extracting' OR ${uiStyleProfilesTable.claimedAt} IS NULL OR ${uiStyleProfilesTable.claimedAt} < ${cutoff})`,
      ),
    )
    .returning();

  if (row) return { claimed: true, row };
  const [existing] = await db
    .select()
    .from(uiStyleProfilesTable)
    .where(eq(uiStyleProfilesTable.projectId, projectId));
  return { claimed: false, reason: existing ? "busy" : "missing", row: existing ?? null };
}

/**
 * Run an extraction for an already-claimed row and save the result.
 *
 * Never throws: a failure lands on the row as `failed` with a short message,
 * the same contract `executeRun` keeps, so a bad repository cannot take down
 * a dispatcher tick or a settings page.
 */
export async function runExtraction(row: UiStyleProfile): Promise<UiStyleProfile | null> {
  const started = Date.now();
  try {
    const repo = await getProjectRepository(row.projectId, row.userId);
    if (!repo?.url) {
      return await finish(row.id, {
        status: "pending",
        error: "No repository is connected to this project yet.",
        extractMs: Date.now() - started,
      });
    }

    const creds = await getConfigs(row.userId, ["GITHUB_TOKEN", "AZURE_REPOS_TOKEN"]);
    const git = await GitService.forRepo(repo.id, {
      githubToken: creds.GITHUB_TOKEN,
      azureReposToken: creds.AZURE_REPOS_TOKEN,
    });

    // Captured BEFORE the reads, so the profile names the commit it describes
    // even if someone pushes while we are fetching.
    const sourceRef = await git.branchHeadSha(repo.defaultBranch).catch(() => null);
    const tree = await git.fetchFilePaths();

    const graph =
      isGraphServable(repo.graphStatus, repo.graphBuiltAt) && repo.graphJson
        ? (repo.graphJson as unknown as GraphifyGraph)
        : null;

    const result = await extractUiStyle({
      tree,
      read: (path) => git.fetchFileWithSha(path),
      graph,
      preferredRoot: row.uiRoot,
    });

    return await finish(row.id, {
      status: result.status,
      repositoryId: repo.id,
      uiRoot: result.uiRoot,
      uiRootOptions: result.uiRootOptions,
      sourceRef,
      framework: result.framework,
      tokens: result.tokens,
      components: result.components,
      conventions: result.conventions,
      exemplars: result.exemplars,
      warnings: result.warnings.length > 0 ? result.warnings : null,
      error: null,
      stale: false,
      revision: row.revision + 1,
      extractedAt: new Date(),
      extractMs: Date.now() - started,
    });
  } catch (err) {
    // No repository detail in the message: it is shown to a user and stored.
    logger.warn({ err, projectId: row.projectId }, "UI style extraction failed");
    return await finish(row.id, {
      status: "failed",
      error: "The repository could not be read. Check the repository connection and try again.",
      extractMs: Date.now() - started,
    });
  }
}

async function finish(
  id: number,
  patch: Partial<typeof uiStyleProfilesTable.$inferInsert>,
): Promise<UiStyleProfile | null> {
  const [row] = await db
    .update(uiStyleProfilesTable)
    .set({ ...patch, claimedAt: null })
    .where(eq(uiStyleProfilesTable.id, id))
    .returning();
  return row ?? null;
}

/**
 * The dispatcher's step: claim up to `limit` profiles that are waiting, or
 * whose claim has gone stale, and extract them.
 *
 * Deliberately additive and sequential, after the run claim — a slow
 * extraction must never delay a scheduled run.
 */
export async function dispatchPendingProfiles(limit = 2): Promise<number[]> {
  const staleCutoff = new Date(Date.now() - CLAIM_STALE_MS);
  const claimed = await db.execute<{ id: number }>(
    sql`UPDATE ui_style_profiles SET status = 'extracting', claimed_at = now()
        WHERE id IN (
          SELECT id FROM ui_style_profiles
          WHERE status = 'pending'
             OR (status = 'extracting' AND claimed_at < ${staleCutoff})
          ORDER BY created_at
          LIMIT ${sql.raw(String(limit))}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`,
  );
  const rows = (Array.isArray(claimed) ? claimed : (claimed as { rows?: unknown[] }).rows ?? []) as Array<{ id: number }>;
  const ids = rows.map((r) => Number(r.id));

  for (const id of ids) {
    const [row] = await db.select().from(uiStyleProfilesTable).where(eq(uiStyleProfilesTable.id, id));
    if (row) await runExtraction(row);
  }
  return ids;
}

/** The repository bound to a project, for the rebind hook. */
export async function repositoryIdForProject(projectId: number, userId: string): Promise<number | null> {
  const [repo] = await db
    .select({ id: repositoriesTable.id })
    .from(repositoriesTable)
    .where(and(eq(repositoriesTable.projectId, projectId), eq(repositoriesTable.userId, userId)));
  return repo?.id ?? null;
}
