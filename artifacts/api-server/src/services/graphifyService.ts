import { and, eq } from "drizzle-orm";
import { db, repositoriesTable } from "@workspace/db";
import { resolveGitCreds } from "./gitToken.js";
import type { GraphifyGraph } from "../../../../shared/types/graphifyGraph.js";

// Pure usability predicates live in a db-free module (unit-testable); re-exported
// here so existing callers keep importing them from graphifyService.
export { isGraphUsable, isGraphServable, isIndexInFlight, INDEX_CLAIM_STALE_MINUTES } from "./graphUsability.js";

export interface GraphifyQueryResult {
  filePath: string;
  lineStart?: number; // parsed from sourceLocation "file.ts:42"
  lineEnd?: number; // lineStart + 40 (generous window)
  nodeLabel: string;
  relation: string; // how it was found: "direct" | "caller" | "callee" | "importer"
  confidence: number; // 0-1
  // Raw weighted relevance score (label==10 / includes==5 / file==3 / id==2 +
  // degree; one-hop neighbours far lower). Exposed for the Phase 4 confidence
  // gate's score-gap/density signals, which need finer granularity than the
  // coarse 1.0/0.9/0.6 confidence tiers.
  score: number;
}

function parseLineNumber(sourceLocation?: string): number | undefined {
  if (!sourceLocation) return undefined;
  const parts = sourceLocation.split(":");
  const n = parseInt(parts[parts.length - 1], 10);
  return isNaN(n) ? undefined : n;
}

/** Query the in-memory graph for the source files most relevant to `keywords`. */
export function queryGraph(
  graph: GraphifyGraph,
  keywords: string[],
  maxResults = 8,
): GraphifyQueryResult[] {
  if (!graph || !graph.nodes?.length) return [];

  const kw = keywords.map((k) => k.toLowerCase());

  const scored = graph.nodes.map((node) => {
    const label = node.label.toLowerCase();
    const file = node.sourceFile?.toLowerCase() ?? "";
    const nodeId = node.id.toLowerCase();

    let score = 0;
    for (const k of kw) {
      if (label === k) score += 10;
      if (label.includes(k)) score += 5;
      if (file.includes(k)) score += 3;
      if (nodeId.includes(k)) score += 2;
    }
    const degree = node.degree ?? 0;
    score += Math.min(degree * 0.1, 2);
    return { node, score };
  });

  const direct = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (direct.length === 0) return [];

  const directIds = new Set(direct.map((d) => d.node.id));
  const results: GraphifyQueryResult[] = [];

  for (const { node, score } of direct) {
    const start = parseLineNumber(node.sourceLocation);
    results.push({
      filePath: node.sourceFile,
      lineStart: start,
      lineEnd: start != null ? start + 40 : undefined,
      nodeLabel: node.label,
      relation: "direct",
      confidence: 1.0,
      score,
    });
  }

  // One hop: callers/callees/importers of direct matches.
  for (const edge of graph.edges) {
    if (results.length >= maxResults * 2) break;
    const isRelevantEdge =
      (directIds.has(edge.source) || directIds.has(edge.target)) &&
      ["calls", "imports", "imports_from"].includes(edge.relation);
    if (!isRelevantEdge) continue;

    const neighborId = directIds.has(edge.source) ? edge.target : edge.source;
    const neighbor = graph.nodes.find((n) => n.id === neighborId);
    if (!neighbor || !neighbor.sourceFile) continue;
    if (results.some((r) => r.filePath === neighbor.sourceFile)) continue;

    const start = parseLineNumber(neighbor.sourceLocation);
    results.push({
      filePath: neighbor.sourceFile,
      lineStart: start,
      lineEnd: start != null ? start + 30 : undefined,
      nodeLabel: neighbor.label,
      relation: edge.relation,
      confidence: edge.confidence === "EXTRACTED" ? 0.9 : 0.6,
      // One-hop neighbours are weak candidates — kept below the graph relevance
      // floor so they don't inflate the confidence density signal.
      score: edge.confidence === "EXTRACTED" ? 3 : 2,
    });
  }

  // Deduplicate by filePath, keeping the highest-confidence hit per file.
  const byFile = new Map<string, GraphifyQueryResult>();
  for (const r of results) {
    const existing = byFile.get(r.filePath);
    if (!existing || r.confidence > existing.confidence) byFile.set(r.filePath, r);
  }

  return Array.from(byFile.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);
}

/** Whether the Graphify microservice is configured for this deployment. */
export function isGraphifyConfigured(): boolean {
  return Boolean(process.env.GRAPHIFY_SERVICE_URL);
}

interface TriggerIndexArgs {
  repoUrl: string;
  githubToken: string;
  repoId: number;
  /**
   * The user who asked for this index, recorded on the row (0047). Required
   * rather than optional: once a team admin can re-index a repository they do
   * not own, the row's own user_id no longer answers "who started this".
   */
  triggeredBy: string | null;
  /** Optional pino-style logger for a warning if the trigger fetch rejects. */
  log?: { warn: (obj: unknown, msg: string) => void };
}

/** How long the handoff to the microservice is given before it is queued instead. */
const DISPATCH_TIMEOUT_MS = 10_000;

/**
 * Park an index for the cron dispatcher to start, without calling the
 * microservice at all (0048).
 *
 * Used where the caller must not pay for the handoff: after a commit lands,
 * where adding an external request to the commit response buys nothing (the
 * graph is read by the NEXT run, minutes or hours later) and risks delaying a
 * response the user is waiting on.
 *
 * A no-op when indexing is unconfigured, so a deployment without the
 * microservice never accumulates a queue it cannot drain.
 */
export async function queueRepoIndex(
  repoId: number,
  triggeredBy: string | null,
  log?: { warn: (obj: unknown, msg: string) => void },
): Promise<boolean> {
  if (!isGraphifyConfigured()) return false;
  try {
    await db
      .update(repositoriesTable)
      .set({
        graphStatus: "queued",
        graphError: null,
        graphStartedAt: new Date(),
        graphTriggeredBy: triggeredBy,
      })
      .where(eq(repositoriesTable.id, repoId));
    return true;
  } catch (err) {
    log?.warn({ err }, "Graphify index queue write failed");
    return false;
  }
}

/**
 * Ask the Graphify microservice to (re)index a repository now. Used on connect
 * and on manual Rebuild, where the customer has just asked and is watching.
 * Returns whether the microservice accepted the handoff (false when indexing is
 * unconfigured, or when the request could not be made). Never throws.
 *
 * BOTH the claim and the handoff are awaited, and that is the whole point.
 *
 * The claim is awaited because `isIndexInFlight` reads graph_started_at to
 * refuse a duplicate index, and a guard whose column is written
 * fire-and-forget is not a guard: on @vercel/node the write can be dropped
 * when the response is sent, and the next caller then sees an unclaimed row.
 *
 * The handoff is awaited because it used to be `void fetch(...)`, which on the
 * same runtime means the request may never leave: the invocation ends when the
 * route answers and the container is frozen mid-flight. An index that silently
 * never started, with the row left reading `indexing`, is exactly the failure
 * the rest of this codebase learned from run #41. A handoff that times out or
 * is refused parks the row as `queued` so the cron dispatcher retries it,
 * which is the one case where "the request was the only chance" is no longer
 * true.
 */
export async function triggerRepoIndex({
  repoUrl,
  githubToken,
  repoId,
  triggeredBy,
  log,
}: TriggerIndexArgs): Promise<boolean> {
  const graphifyUrl = process.env.GRAPHIFY_SERVICE_URL;
  if (!graphifyUrl) return false;

  // Claim the index: status, when it started and who asked (0021, 0047). The
  // callback resolves the status to succeeded/failed. Awaited, per the note
  // above. A failure here is logged and swallowed — the index itself is worth
  // attempting even when the bookkeeping write fails, and the stale-claim
  // window means a missing claim cannot wedge the repository.
  try {
    await db
      .update(repositoriesTable)
      .set({
        graphStatus: "indexing",
        graphError: null,
        graphStartedAt: new Date(),
        graphTriggeredBy: triggeredBy,
      })
      .where(eq(repositoriesTable.id, repoId));
  } catch (err) {
    log?.warn({ err }, "Graphify status update to indexing failed");
  }

  const outcome = await dispatchIndexRequest(repoUrl, githubToken, repoId, log);
  if (outcome.ok) return true;
  // Queue rather than fail. Nothing about the repository is wrong: the handoff
  // did not land, and a 5xx from a restarting service is exactly what a retry
  // is for. `failed` is reserved for what the microservice's own callback says
  // when extraction itself breaks, and conflating the two would show a customer
  // an error for a transient blip.
  await parkAsQueued(repoId, outcome.note, log);
  return false;
}

/**
 * The handoff itself: one POST to the microservice, bounded by a timeout.
 *
 * Shared by the immediate trigger and the dispatcher's drain so there is one
 * place that knows the request shape and one place that decides what a refusal
 * means. Returns a note written for a customer to read on the repository row,
 * never the raw error: a connection string or a token could otherwise reach
 * the UI through graph_error.
 */
async function dispatchIndexRequest(
  repoUrl: string,
  githubToken: string,
  repoId: number,
  log?: { warn: (obj: unknown, msg: string) => void },
): Promise<{ ok: boolean; note: string }> {
  const graphifyUrl = process.env.GRAPHIFY_SERVICE_URL;
  if (!graphifyUrl) return { ok: false, note: "Indexing is not configured." };
  const callbackUrl = `${process.env.APP_BASE_URL ?? "https://app.kandryn.com"}/api/internal/graphify-callback`;
  try {
    const res = await fetch(`${graphifyUrl}/index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-secret": process.env.GRAPHIFY_SERVICE_SECRET ?? "",
      },
      body: JSON.stringify({
        repo_url: repoUrl,
        github_token: githubToken,
        repo_id: repoId,
        callback_url: callbackUrl,
      }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true, note: "" };
    log?.warn({ repoId, status: res.status }, "Graphify index handoff refused");
    return { ok: false, note: `The indexing service answered ${res.status}. Retrying shortly.` };
  } catch (err) {
    log?.warn({ repoId, err }, "Graphify index handoff failed");
    return { ok: false, note: "The indexing service could not be reached. Retrying shortly." };
  }
}

/**
 * Take a queued repository, exactly once.
 *
 * A CONDITIONAL update: the row moves out of `queued` only if it is still in
 * `queued`, so of two overlapping dispatcher ticks exactly one gets `true` and
 * the other gets `false` and moves on. Selecting and then updating would let
 * both proceed and start two clone-and-extract jobs on a customer's
 * repository, which is the whole reason this is one statement. It is the same
 * shape `POST /runs/:id/execute` uses to make a double-click one run.
 *
 * Exported so it can be raced directly in
 * scripts/reposetup-verify/queue.ts. Racing it through the drain does not
 * work: the two ticks serialize on the connection pool, so the second one's
 * read happens after the first one's write and the condition is never
 * exercised. A test that cannot fail when the condition is removed proves
 * nothing, and the first version of that test did exactly that.
 */
export async function claimQueuedIndex(repoId: number): Promise<boolean> {
  const claimed = await db
    .update(repositoriesTable)
    .set({ graphStatus: "indexing", graphError: null, graphStartedAt: new Date() })
    .where(and(eq(repositoriesTable.id, repoId), eq(repositoriesTable.graphStatus, "queued")))
    .returning({ id: repositoriesTable.id });
  return claimed.length > 0;
}

/**
 * Move a claimed row back to `queued` so the dispatcher picks it up.
 *
 * Deliberately not `failed`: nothing about the repository is wrong, the
 * handoff did not land. `failed` is what the microservice's own callback says
 * when extraction itself breaks, and conflating the two would show a customer
 * an error for a transient service blip.
 */
async function parkAsQueued(
  repoId: number,
  note: string,
  log?: { warn: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    await db
      .update(repositoriesTable)
      .set({ graphStatus: "queued", graphError: note })
      .where(eq(repositoriesTable.id, repoId));
  } catch (err) {
    log?.warn({ repoId, err }, "Graphify queue fallback write failed");
  }
}

/** How many queued indexes one dispatcher tick starts. */
const DRAIN_BATCH = 2;

/**
 * Start the indexes waiting in `queued` (0048). Called by the cron dispatcher.
 *
 * Bounded at DRAIN_BATCH per tick for the same reason the run dispatcher is
 * bounded at two: each handoff is an outbound request inside a function with a
 * 300s ceiling that is also running the run dispatch, and a backlog drains over
 * several ticks rather than risking the whole tick.
 *
 * The claim is a CONDITIONAL update (`WHERE graph_status = 'queued'`), so two
 * overlapping ticks cannot both start the same repository: the second update
 * matches no row. Selecting then updating would not be enough, and this is the
 * same shape `POST /runs/:id/execute` uses to make a double-click one run.
 *
 * Never throws: the dispatcher treats this as an additive step and one bad
 * repository must not abort the tick.
 */
export async function dispatchQueuedIndexes(): Promise<number[]> {
  if (!isGraphifyConfigured()) return [];

  const waiting = await db
    .select({ id: repositoriesTable.id, userId: repositoriesTable.userId, url: repositoriesTable.url, triggeredBy: repositoriesTable.graphTriggeredBy })
    .from(repositoriesTable)
    .where(eq(repositoriesTable.graphStatus, "queued"))
    .orderBy(repositoriesTable.graphStartedAt)
    .limit(DRAIN_BATCH);

  const started: number[] = [];
  for (const repo of waiting) {
    if (!repo.url) {
      // Nothing to index and nothing a retry will fix. Settle the row rather
      // than leaving it in the queue for ever.
      await db
        .update(repositoriesTable)
        .set({ graphStatus: "failed", graphError: "This repository has no URL. Set one, then rebuild." })
        .where(and(eq(repositoriesTable.id, repo.id), eq(repositoriesTable.graphStatus, "queued")));
      continue;
    }
    if (!(await claimQueuedIndex(repo.id))) continue; // another tick took it

    // The OWNER's credentials: the queue outlives the request that filled it,
    // so there is no actor here, and resolveGitCreds derives the workspace from
    // the id it is given.
    const creds = await resolveGitCreds(repo.userId);
    const outcome = await dispatchIndexRequest(repo.url, creds.githubToken ?? "", repo.id);
    if (outcome.ok) {
      started.push(repo.id);
    } else {
      // Back to the queue for the next tick. The handoff, not the repository,
      // is what failed.
      await parkAsQueued(repo.id, outcome.note);
    }
  }
  return started;
}
