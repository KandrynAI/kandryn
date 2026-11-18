import { and, eq, isNull } from "drizzle-orm";
import { db, repositoriesTable, projectsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { isIndexInFlight } from "./graphUsability.js";
import { startBaselineScan } from "./baselineScanService.js";
import { getTeamForUser } from "./teamService.js";
import { readSetupChoice, wantsBaselineScan } from "../../../../shared/types/repoSetup.js";

/**
 * Acting on what a customer chose when they connected a repository (0048).
 *
 * Only one choice needs anything beyond the connect request itself. `none` and
 * `index` are settled there and then: the index is dispatched or queued inline
 * and the row is stamped complete. `index_scan` cannot be, because a baseline
 * scan reads every source file in the repository, submits a Message Batch and
 * is collected minutes later by the same dispatcher that runs this. Starting
 * one inside the connect request would mean a response the customer waits
 * seconds for and a 300s ceiling it could exceed.
 *
 * So this runs as an additive step on the cron tick, after the run dispatch,
 * like the UI style extraction (0042) and the Jira retention sweep (0043). It
 * never throws: a repository whose setup cannot be honoured records why and is
 * stamped, rather than being retried for ever.
 */

/** How many pending setups one tick acts on. */
const BATCH = 2;

/** The row shape this module reads. */
type PendingRow = {
  id: number;
  userId: string;
  projectId: number | null;
  setupChoice: string | null;
  graphStatus: string | null;
  graphStartedAt: Date | null;
};

/**
 * Settle a repository's setup: nothing more will be attempted for it.
 *
 * `setup_choice` is deliberately left as it was. The record of what the
 * customer asked for is the one thing an auditor wants when a scan appears
 * that nobody remembers starting, so completion is a separate stamp rather
 * than the choice being cleared.
 */
async function complete(repoId: number, error: string | null): Promise<void> {
  await db
    .update(repositoriesTable)
    .set({ setupCompletedAt: new Date(), setupError: error })
    .where(eq(repositoriesTable.id, repoId));
}

/**
 * Start the baseline scan a customer asked for at connect.
 *
 * The actor is the user who CONNECTED the repository, which is the person who
 * made the choice. That matters twice over: `canRunBaselineScan` is checked
 * against their authority rather than against nobody's, and the scan spends
 * the model credentials that resolve from them. A cron tick has no actor of
 * its own, and inventing one would mean a scan whose cost lands on whoever the
 * code happened to pick.
 */
async function startScan(row: PendingRow): Promise<void> {
  const team = await getTeamForUser(row.userId);
  try {
    const scan = await startBaselineScan(row.id, {
      userId: row.userId,
      teamId: team?.team.id ?? null,
      teamRole: team?.role ?? null,
    });
    logger.info({ repoId: row.id, scanId: scan.id }, "Baseline scan started from the connect-time setup choice");
    await complete(row.id, null);
  } catch (err) {
    // A refusal here is a real answer, not a transient failure: no model key,
    // a repository above the file cap, a scan already running. Record it and
    // stop, so the customer sees why the scan they asked for did not happen
    // instead of a dispatcher retrying it every five minutes for ever.
    const message = err instanceof Error ? err.message : "The scan could not be started.";
    logger.warn({ repoId: row.id, err }, "Connect-time baseline scan could not be started");
    await complete(row.id, message);
  }
}

/**
 * Act on every repository whose connect-time choice is still outstanding.
 *
 * Returns the repository ids acted on. Never throws.
 */
export async function dispatchPendingSetups(): Promise<number[]> {
  const pending = await db
    .select({
      id: repositoriesTable.id,
      userId: repositoriesTable.userId,
      projectId: repositoriesTable.projectId,
      setupChoice: repositoriesTable.setupChoice,
      graphStatus: repositoriesTable.graphStatus,
      graphStartedAt: repositoriesTable.graphStartedAt,
    })
    .from(repositoriesTable)
    .where(isNull(repositoriesTable.setupCompletedAt))
    .orderBy(repositoriesTable.id)
    .limit(BATCH);

  const acted: number[] = [];
  for (const row of pending) {
    const choice = readSetupChoice(row.setupChoice);
    if (!wantsBaselineScan(choice)) {
      // Nothing is outstanding for `none` or `index`: the connect request
      // settles both. A row that reaches here is one whose stamp did not land,
      // so stamp it now rather than reading it again every tick.
      await complete(row.id, null);
      acted.push(row.id);
      continue;
    }
    // Wait for the index to settle first, because the scan's file discovery
    // prefers a built graph over the raw tree: the graph is a parser's output,
    // so it already excludes docs, config and anything unparseable. Waiting is
    // bounded by the same stale window the duplicate guard uses, so an index
    // that never finishes delays the scan by minutes, not for ever.
    if (isIndexInFlight(row.graphStatus, row.graphStartedAt)) continue;
    await startScan(row);
    acted.push(row.id);
  }
  return acted;
}

/**
 * Whether a project's remembered default should be offered on the connect form.
 *
 * Read-only, and a convenience for the route rather than a decision: the form
 * sends an explicit choice, and this is only what it arrives pre-selected with.
 */
export async function projectSetupDefault(projectId: number): Promise<string | null> {
  const [project] = await db
    .select({ setupChoice: projectsTable.setupChoice })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId)));
  return project?.setupChoice ?? null;
}
